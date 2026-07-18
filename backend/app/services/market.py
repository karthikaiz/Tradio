import asyncio
import logging
from datetime import datetime, timezone

from app.services.angel_client import angel_session
from app.services.instruments import get_token

logger = logging.getLogger(__name__)

# In-memory cache: {ticker: (price, fetched_at)}
_cache: dict[str, tuple[float, datetime]] = {}
CACHE_TTL_SECONDS = 3


class MarketDataError(Exception):
    def __init__(self, ticker: str, reason: str):
        self.ticker = ticker
        self.reason = reason
        super().__init__(f"Market data unavailable for {ticker}: {reason}")


async def get_price(ticker: str) -> float:
    """
    Returns the current INR price for a NSE ticker.
    Caches results for CACHE_TTL_SECONDS. Raises MarketDataError on failure.
    """
    now = datetime.now(timezone.utc)

    if ticker in _cache:
        cached_price, fetched_at = _cache[ticker]
        if (now - fetched_at).total_seconds() < CACHE_TTL_SECONDS:
            logger.debug(f"Cache hit for {ticker}")
            return cached_price

    token = await get_token(ticker)
    if not token:
        raise MarketDataError(ticker, "Symbol not found in instruments master")

    trading_symbol = f"{ticker}-EQ"

    try:
        client = await angel_session.client()
        loop = asyncio.get_event_loop()

        def _fetch():
            return client.ltpData("NSE", trading_symbol, token)

        resp = await asyncio.wait_for(
            loop.run_in_executor(None, _fetch),
            timeout=8.0,
        )
        if not resp.get("status"):
            raise MarketDataError(ticker, resp.get("message", "API error"))

        price = float(resp["data"]["ltp"])
    except MarketDataError:
        raise
    except Exception as e:
        raise MarketDataError(ticker, str(e)) from e

    if price <= 0:
        raise MarketDataError(ticker, "Returned price is zero or negative")

    _cache[ticker] = (price, now)
    logger.info(f"Price for {ticker}: ₹{price:.2f}")
    return price


async def get_quote(ticker: str) -> dict:
    """
    Returns full quote: ltp, percent_change, year_high, year_low, volume.
    Returns empty dict on failure (non-critical — used for enrichment only).
    """
    token = await get_token(ticker)
    if not token:
        return {}

    try:
        client = await angel_session.client()
        loop = asyncio.get_event_loop()

        def _fetch():
            return client.getMarketData("FULL", {"NSE": [token]})

        resp = await loop.run_in_executor(None, _fetch)
        if not resp.get("status"):
            return {}

        fetched = resp.get("data", {}).get("fetched", [])
        if not fetched:
            return {}

        d = fetched[0]
        return {
            "ltp": d.get("ltp"),
            "percent_change": d.get("percentChange"),
            "year_high": d.get("52WeekHigh"),
            "year_low": d.get("52WeekLow"),
            "volume": d.get("tradeVolume"),
        }
    except Exception as e:
        logger.warning(f"get_quote failed for {ticker}: {e}")
        return {}


def get_cache_info(ticker: str) -> tuple[bool, datetime | None]:
    """Returns (is_cached, fetched_at) for a ticker."""
    if ticker not in _cache:
        return False, None
    _, fetched_at = _cache[ticker]
    age = (datetime.now(timezone.utc) - fetched_at).total_seconds()
    return age < CACHE_TTL_SECONDS, fetched_at


def clear_cache():
    """Clear the price cache — used in tests."""
    _cache.clear()
