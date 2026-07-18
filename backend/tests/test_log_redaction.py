"""Tests for app-level log redaction — credentials must never reach handlers."""

import io
import logging

from app.log_redaction import install_redaction, scrub


def _capture_logger(name):
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    return logger, stream, handler


def test_scrub_smartapi_style_payload():
    msg = ("Request: {'clientcode': 'ABC123', 'password': 'fakepass1', "
           "'totp': '999999'}, Headers: {'X-PrivateKey': 'fakekey99'}")
    out = scrub(msg)
    assert "fakepass1" not in out
    assert "999999" not in out
    assert "fakekey99" not in out
    assert "***REDACTED***" in out


def test_scrub_bearer_token():
    out = scrub("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.fake.token")
    assert "eyJhbGciOiJIUzI1NiJ9" not in out


def test_installed_factory_redacts_msg_and_args():
    install_redaction()
    logger, stream, handler = _capture_logger("redaction-test")
    try:
        logger.error("login failed: password: 'sekrit42' totp=123456")
        logger.error("payload %s", {"password": "sekrit43", "user": "x"})
        text = stream.getvalue()
    finally:
        logger.removeHandler(handler)
    assert "sekrit42" not in text
    assert "sekrit43" not in text
    assert "123456" not in text
    assert "***REDACTED***" in text


def test_normal_messages_untouched():
    install_redaction()
    logger, stream, handler = _capture_logger("redaction-test-2")
    try:
        logger.info("Order FILLED: INFY qty=4 @ 1520.00")
        text = stream.getvalue()
    finally:
        logger.removeHandler(handler)
    assert "Order FILLED: INFY qty=4 @ 1520.00" in text
