import asyncio
import logging
import os
import time
import pyotp
from SmartApi import SmartConnect

logger = logging.getLogger(__name__)


class AngelSession:
    def __init__(self):
        self._client: SmartConnect | None = None
        self._expires_at: float = 0
        self._lock = asyncio.Lock()

    async def client(self) -> SmartConnect:
        async with self._lock:
            if self._client is None or time.time() >= self._expires_at:
                await self._login()
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
