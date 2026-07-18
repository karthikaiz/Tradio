"""App-level log redaction — safety audit cleanup.

Third-party libraries (notably smartapi-python's smartConnect) log full broker
login payloads — clientcode, password, TOTP — into stderr on errors, which
launchd captures into backend.log. Patching the library is fragile; instead we
install a global LogRecord factory that scrubs sensitive key/value pairs and
bearer tokens out of every record (msg and args) before any handler formats it.

Call install_redaction() once at app startup. Idempotent.
"""

import logging
import re

_SENSITIVE_KEYS = (
    "password", "totp", "mpin", "pin", "api_key", "apikey",
    "access_token", "refresh_token", "feed_token", "feedtoken",
    "accesstoken", "refreshtoken", "jwttoken", "jwt_token",
    "authorization", "cookie", "set-cookie", "set_cookie",
    "x-privatekey", "x_privatekey", "client_secret", "secret",
)

# 'password': 'value' | "password": "value" | password=value | password: value
_KV_RE = re.compile(
    r"""(['"]?(?:%s)['"]?\s*[:=]\s*)(['"]?)([^'",}\s]+)""" % "|".join(_SENSITIVE_KEYS),
    re.IGNORECASE,
)
_BEARER_RE = re.compile(r"(Bearer\s+)[A-Za-z0-9\-_.~+/]+=*", re.IGNORECASE)


def scrub(text: str) -> str:
    # Bearer first — otherwise the 'authorization' KV rule consumes the word
    # "Bearer" as the value and leaves the token behind
    text = _BEARER_RE.sub(r"\1***REDACTED***", text)
    text = _KV_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}***REDACTED***", text)
    return text


def _scrub_dict(d: dict) -> dict:
    """Redact values whose key is sensitive; scrub string values too."""
    out = {}
    for k, v in d.items():
        if isinstance(k, str) and k.lower().replace("-", "_") in _SENSITIVE_KEYS:
            out[k] = "***REDACTED***"
        elif isinstance(v, str):
            out[k] = scrub(v)
        elif isinstance(v, dict):
            out[k] = _scrub_dict(v)
        else:
            out[k] = v
    return out


class _ScrubOnStr:
    """Wraps a non-string log arg (e.g. a request dict) so its string form is
    scrubbed at format time."""

    def __init__(self, obj):
        self._obj = obj

    def __str__(self):
        return scrub(str(self._obj))

    def __repr__(self):
        return scrub(repr(self._obj))


def install_redaction() -> None:
    if getattr(logging, "_tradio_redaction_installed", False):
        return
    old_factory = logging.getLogRecordFactory()

    def factory(*args, **kwargs):
        record = old_factory(*args, **kwargs)
        try:
            if isinstance(record.msg, str):
                record.msg = scrub(record.msg)
            if record.args:
                if isinstance(record.args, dict):
                    # logging's single-dict-args special case
                    record.args = _scrub_dict(record.args)
                else:
                    record.args = tuple(
                        scrub(a) if isinstance(a, str)
                        else _ScrubOnStr(a) if isinstance(a, (dict, list))
                        else a
                        for a in record.args
                    )
        except Exception:
            pass  # redaction must never break logging itself
        return record

    logging.setLogRecordFactory(factory)
    logging._tradio_redaction_installed = True
    logging.getLogger(__name__).info("Log redaction installed")
