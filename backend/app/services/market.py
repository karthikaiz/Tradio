import asyncio
import logging
from datetime import datetime, timezone, timedelta
import yfinance as yf

logger = logging.getLogger(__name__)

# In-memory cache: {ticker: (price, fetched_at)}
_cache: dict[str, tuple[float, datetime]] = {}
CACHE_TTL_SECONDS = 3


class MarketDataError(Exception):
    def __init__(self, ticker: str, reason: str):
        self.ticker = ticker
        self.reason = reason
        super().__init__(f"Market data unavailable for {ticker}: {reason}")


def _fetch_price_sync(ticker_ns: str) -> float:
    """Synchronous yfinance call — always run via run_in_executor."""
    stock = yf.Ticker(ticker_ns)
    info = stock.info

    # Primary: currentPrice
    price = info.get("currentPrice")
    if price and price > 0:
        return float(price)

    # Fallback: latest closing price from history
    hist = stock.history(period="1d")
    if not hist.empty:
        return float(hist["Close"].iloc[-1])

    raise MarketDataError(ticker_ns, "No price data returned")


async def get_price(ticker: str) -> float:
    """
    Returns the current INR price for a NSE ticker.
    Appends .NS internally. Caches results for 60 seconds.
    Raises MarketDataError on any failure.
    """
    now = datetime.now(timezone.utc)

    # Check cache
    if ticker in _cache:
        cached_price, fetched_at = _cache[ticker]
        age = (now - fetched_at).total_seconds()
        if age < CACHE_TTL_SECONDS:
            logger.debug(f"Cache hit for {ticker} (age {age:.1f}s)")
            return cached_price

    ticker_ns = ticker if ticker.startswith("^") else f"{ticker}.NS"
    logger.info(f"Fetching price for {ticker_ns} from yfinance")

    try:
        loop = asyncio.get_event_loop()
        price = await loop.run_in_executor(None, _fetch_price_sync, ticker_ns)
    except MarketDataError:
        raise
    except Exception as e:
        raise MarketDataError(ticker, str(e)) from e

    if price <= 0:
        raise MarketDataError(ticker, "Returned price is zero or negative")

    _cache[ticker] = (price, now)
    logger.info(f"Price for {ticker}: ₹{price:.2f}")
    return price


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
