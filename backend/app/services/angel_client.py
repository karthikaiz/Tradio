import asyncio
import logging
import os
import time
import pyotp
from SmartApi import SmartConnect

logger = logging.getLogger(__name__)


_LOGIN_COOLDOWN_S = 15  # avoid hammering Angel's rate-limited auth endpoint


class AngelSession:
    def __init__(self):
        self._client: SmartConnect | None = None
        self._expires_at: float = 0
        self._lock = asyncio.Lock()
        self._last_failure_at: float = 0
        self._last_failure_reason: str = ""

    async def client(self) -> SmartConnect:
        async with self._lock:
            if self._client is None or time.time() >= self._expires_at:
                # Every failed login used to retry on the very next price
                # request with zero delay — every ticker in a multi-price
                # batch re-hit Angel's login endpoint back-to-back. If Angel
                # rate-limits generateSession (it does), that retry storm
                # extends the outage instead of letting it clear. A short
                # cooldown after a failure makes each retry count.
                since_failure = time.time() - self._last_failure_at
                if self._last_failure_at and since_failure < _LOGIN_COOLDOWN_S:
                    raise RuntimeError(
                        f"Angel login in cooldown ({_LOGIN_COOLDOWN_S - since_failure:.0f}s "
                        f"left) after failure: {self._last_failure_reason}"
                    )
                try:
                    await self._login()
                    self._last_failure_at = 0
                except Exception as e:
                    self._last_failure_at = time.time()
                    self._last_failure_reason = str(e)
                    raise
        return self._client  # type: ignore[return-value]

    async def _login(self):
        api_key = os.environ["ANGEL_API_KEY"]
        client_id = os.environ["ANGEL_CLIENT_ID"]
        password = os.environ["ANGEL_PASSWORD"]
        totp_secret = os.environ["ANGEL_TOTP_SECRET"]

        def _do_login():
            obj = SmartConnect(api_key=api_key)
            totp = pyotp.TOTP(totp_secret).now()
            resp = obj.generateSession(client_id, password, totp)
            if not resp.get("status"):
                raise RuntimeError(f"Angel login failed: {resp.get('message', 'unknown')}")
            return obj

        loop = asyncio.get_running_loop()
        self._client = await loop.run_in_executor(None, _do_login)
        self._expires_at = time.time() + 6 * 3600
        logger.info("AngelOne session established")


angel_session = AngelSession()
