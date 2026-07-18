import asyncio
import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

_BACKOFF_INITIAL_S = 5
_BACKOFF_MAX_S = 60


class PriceStream:
    """Manages a SmartWebSocketV2 connection in a daemon thread and fans
    price ticks out to asyncio Queue subscribers.

    The Angel WS gives up after its internal retry budget; this class detects
    a dead/exhausted connection (closed callback OR dead thread) and rebuilds
    it on the next ensure_started() call, with bounded exponential backoff so
    a hard outage doesn't hammer the broker."""

    def __init__(self):
        self._ws = None
        self._thread: threading.Thread | None = None
        self._prices: dict[str, dict] = {}          # ticker → {ticker, price, change_pct}
        self._token_to_ticker: dict[str, str] = {}  # token  → ticker
        self._subscribed_tokens: set[str] = set()
        self._subscribers: list[tuple[asyncio.Queue, asyncio.AbstractEventLoop]] = []
        self._lock = threading.Lock()
        self._start_lock: asyncio.Lock | None = None  # created lazily inside event-loop
        self._started = False
        # health
        self._connected = False
        self._last_tick_ts: float = 0.0
        self._last_error: str = ""
        self._restart_count = 0
        self._last_start_ts: float = 0.0
        self._backoff_s: float = 0.0

    # ── lifecycle ──────────────────────────────────────────────────────────────

    def _is_alive(self) -> bool:
        return self._started and self._thread is not None and self._thread.is_alive()

    async def ensure_started(self, client) -> None:
        if self._start_lock is None:
            self._start_lock = asyncio.Lock()
        async with self._start_lock:
            if self._is_alive():
                return
            # Dead or never started — respect backoff before rebuilding
            since_last = time.time() - self._last_start_ts
            if self._last_start_ts and since_last < self._backoff_s:
                logger.debug(
                    "WS rebuild deferred — backoff %.0fs remaining",
                    self._backoff_s - since_last,
                )
                return
            from SmartApi.smartWebSocketV2 import SmartWebSocketV2  # noqa: PLC0415

            if self._started:
                logger.warning(
                    "Angel WS thread dead — rebuilding (restart #%d, last_error=%s)",
                    self._restart_count + 1, self._last_error or "none",
                )
            ws = SmartWebSocketV2(
                client.access_token,
                os.environ["ANGEL_API_KEY"],
                client.userId,
                client.feed_token,
            )
            ws.on_open = self._on_open
            ws.on_data = self._on_data
            ws.on_error = self._on_error
            ws.on_close = self._on_close
            self._ws = ws
            self._started = True
            self._restart_count += 1
            self._last_start_ts = time.time()
            self._backoff_s = min(
                max(_BACKOFF_INITIAL_S, self._backoff_s * 2), _BACKOFF_MAX_S
            )
            t = threading.Thread(target=ws.connect, daemon=True, name="angel-ws")
            self._thread = t
            t.start()
            logger.info("SmartWebSocketV2 thread started")

    def health(self) -> dict:
        """Read-only health snapshot for monitoring. Contains no credentials."""
        return {
            "started": self._started,
            "connected": self._connected,
            "thread_alive": self._thread.is_alive() if self._thread else False,
            "last_tick_age_s": round(time.time() - self._last_tick_ts, 1)
                               if self._last_tick_ts else None,
            "last_error": self._last_error or None,
            "restart_count": self._restart_count,
            "subscribed_tokens": len(self._subscribed_tokens),
            "subscribers": len(self._subscribers),
        }

    # ── WebSocket callbacks (WebSocket thread) ─────────────────────────────────

    def _on_open(self, ws):
        logger.info("SmartWebSocketV2 connected")
        self._connected = True
        self._backoff_s = 0.0  # healthy again — next rebuild starts fresh
        self._resubscribe_all()

    def _on_data(self, ws, message, data_type, continue_flag):
        self._last_tick_ts = time.time()
        try:
            token = str(message.get("token", ""))
            ticker = self._token_to_ticker.get(token)
            if not ticker:
                return

            ltp = message.get("last_traded_price", 0) / 100.0
            closed = message.get("closed_price", 0) / 100.0
            change_pct = round(((ltp - closed) / closed * 100) if closed else 0.0, 2)

            data = {"ticker": ticker, "price": ltp, "change_pct": change_pct}
            self._prices[ticker] = data

            with self._lock:
                for q, loop in self._subscribers:
                    loop.call_soon_threadsafe(q.put_nowait, dict(data))
        except Exception:
            logger.exception("on_data error")

    def _on_error(self, ws, error):
        # error is a connection/library message — never contains credentials
        self._last_error = str(error)[:200]
        logger.error("SmartWebSocketV2 error: %s", error)

    def _on_close(self, ws):
        logger.info("SmartWebSocketV2 closed")
        self._connected = False
        self._started = False  # allow restart on next request

    # ── subscription management ────────────────────────────────────────────────

    def _resubscribe_all(self):
        if not self._ws or not self._subscribed_tokens:
            return
        try:
            self._ws.subscribe(
                "tradio", 1,
                [{"exchangeType": 1, "tokens": list(self._subscribed_tokens)}],
            )
        except Exception:
            logger.exception("resubscribe error")

    async def add_tickers(self, tickers: list[str]) -> None:
        from app.services.instruments import get_tokens_batch  # noqa: PLC0415
        tokens_map = await get_tokens_batch(tickers)
        new_tokens: list[str] = []
        for ticker, token in tokens_map.items():
            if token not in self._subscribed_tokens:
                new_tokens.append(token)
                self._subscribed_tokens.add(token)
                self._token_to_ticker[token] = ticker
        if new_tokens and self._ws:
            try:
                self._ws.subscribe(
                    "tradio", 1,
                    [{"exchangeType": 1, "tokens": new_tokens}],
                )
                logger.info("Subscribed to %d new token(s): %s", len(new_tokens), new_tokens)
            except Exception:
                logger.exception("subscribe error")

    def get_current(self, tickers: list[str]) -> dict[str, dict]:
        return {t: self._prices[t] for t in tickers if t in self._prices}

    # ── subscriber management ──────────────────────────────────────────────────

    def add_subscriber(self, q: asyncio.Queue, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            self._subscribers.append((q, loop))

    def remove_subscriber(self, q: asyncio.Queue) -> None:
        with self._lock:
            self._subscribers = [(qq, lp) for qq, lp in self._subscribers if qq is not q]


price_stream = PriceStream()
