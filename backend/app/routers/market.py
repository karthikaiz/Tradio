import asyncio
import logging
import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
from app.services.market import get_price, get_cache_info, MarketDataError

router = APIRouter(prefix="/api/market", tags=["market"])
logger = logging.getLogger(__name__)

# Fixed list of NSE large-caps for market categories
NSE_LARGECAPS = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "BHARTIARTL",
    "ICICIBANK", "SBIN", "HINDUNILVR", "ITC", "KOTAKBANK",
    "LT", "AXISBANK", "BAJFINANCE", "ASIANPAINT", "MARUTI",
    "WIPRO", "ULTRACEMCO", "TITAN", "SUNPHARMA", "NESTLEIND",
    "POWERGRID", "NTPC", "TECHM", "HCLTECH", "ONGC",
    "JSWSTEEL", "TATAMOTORS", "TATASTEEL", "ADANIENT", "ADANIPORTS",
]


def _fetch_category_data_sync(ticker: str) -> dict | None:
    try:
        info = yf.Ticker(f"{ticker}.NS").info
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        change_pct = info.get("regularMarketChangePercent")
        change = info.get("regularMarketChange")
        volume = info.get("regularMarketVolume") or 0
        name = info.get("shortName") or info.get("longName") or ticker
        if price is None:
            return None
        return {
            "ticker": ticker,
            "name": name,
            "price": round(float(price), 2),
            "change": round(float(change or 0), 2),
            "change_pct": round(float(change_pct or 0), 2),
            "volume": int(volume),
        }
    except Exception:
        return None

VALID_PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y"}
VALID_INTERVALS = {"1m", "5m", "15m", "30m", "1h", "1d"}

PERIOD_INTERVAL_MAP = {
    "1d": "5m",
    "5d": "15m",
    "1mo": "1d",
    "3mo": "1d",
    "6mo": "1d",
    "1y": "1d",
}


@router.get("/price")
async def get_market_price(ticker: str = Query(..., description="NSE ticker symbol e.g. RELIANCE")):
    ticker = ticker.upper().strip()
    try:
        price = await get_price(ticker)
        is_cached, fetched_at = get_cache_info(ticker)
        return {
            "ticker": ticker,
            "price": round(price, 2),
            "cached": is_cached,
            "as_of": fetched_at.isoformat() if fetched_at else None,
        }
    except MarketDataError as e:
        logger.warning(f"Market data error for {ticker}: {e.reason}")
        raise HTTPException(
            status_code=503,
            detail={"error": "Market data unavailable", "ticker": ticker, "reason": e.reason},
        )


@router.get("/multi-price")
async def get_multi_price(tickers: str = Query(..., description="Comma-separated ticker symbols")):
    """Fetch prices for multiple tickers in parallel. Returns partial results on individual failures."""
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return {"prices": {}}

    async def fetch_one(ticker: str):
        try:
            price = await get_price(ticker)
            is_cached, fetched_at = get_cache_info(ticker)
            return ticker, {
                "price": round(price, 2),
                "as_of": fetched_at.isoformat() if fetched_at else None,
                "error": None,
            }
        except MarketDataError as e:
            return ticker, {"price": None, "as_of": None, "error": e.reason}

    results = await asyncio.gather(*[fetch_one(t) for t in ticker_list])
    return {"prices": dict(results)}


def _fetch_history_sync(ticker_ns: str, period: str, interval: str):
    df = yf.Ticker(ticker_ns).history(period=period, interval=interval)
    if df.empty:
        raise MarketDataError(ticker_ns, "No historical data returned")
    candles = []
    for ts, row in df.iterrows():
        candles.append({
            "time": int(ts.timestamp()),
            "open": round(float(row["Open"]), 2),
            "high": round(float(row["High"]), 2),
            "low": round(float(row["Low"]), 2),
            "close": round(float(row["Close"]), 2),
            "volume": int(row["Volume"]),
        })
    return candles


@router.get("/history")
async def get_history(
    ticker: str = Query(...),
    period: str = Query("1d"),
):
    ticker = ticker.upper().strip()
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"Invalid period. Use one of: {VALID_PERIODS}")

    interval = PERIOD_INTERVAL_MAP[period]
    ticker_ns = f"{ticker}.NS"
    try:
        loop = asyncio.get_event_loop()
        candles = await loop.run_in_executor(None, _fetch_history_sync, ticker_ns, period, interval)
        return {"ticker": ticker, "period": period, "interval": interval, "candles": candles}
    except MarketDataError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "Historical data unavailable", "ticker": ticker, "reason": e.reason},
        )
    except Exception as e:
        logger.error(f"History fetch error for {ticker}: {e}")
        raise HTTPException(status_code=503, detail={"error": str(e), "ticker": ticker})


def _search_sync(query: str):
    results = yf.Search(query, max_results=8).quotes
    matches = []
    for r in results:
        symbol: str = r.get("symbol", "")
        exchange = r.get("exchange", "")
        if exchange not in ("NSI", "BSE"):
            continue
        if symbol.endswith(".NS"):
            t = symbol[:-3]
        elif symbol.endswith(".BO"):
            t = symbol[:-3]
        else:
            continue
        matches.append({
            "ticker": t,
            "name": r.get("longname") or r.get("shortname", t),
            "exchange": "NSE" if exchange == "NSI" else "BSE",
        })
    seen = set()
    deduped = []
    for m in matches:
        if m["ticker"] not in seen:
            seen.add(m["ticker"])
            deduped.append(m)
    return deduped


@router.get("/search")
async def search_tickers(q: str = Query(..., min_length=2)):
    try:
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, _search_sync, q)
        return {"results": results}
    except Exception as e:
        logger.warning(f"Search error for '{q}': {e}")
        return {"results": []}


@router.get("/categories")
async def get_market_categories():
    """
    Returns top gainers, top losers, most active, and stable stocks
    from a fixed list of NSE large-caps. Fetched in parallel.
    """
    loop = asyncio.get_event_loop()

    async def fetch_one(ticker: str):
        return await loop.run_in_executor(None, _fetch_category_data_sync, ticker)

    results = await asyncio.gather(*[fetch_one(t) for t in NSE_LARGECAPS])
    stocks = [r for r in results if r is not None]

    if not stocks:
        return {"gainers": [], "losers": [], "active": [], "stable": []}

    sorted_by_change = sorted(stocks, key=lambda x: x["change_pct"], reverse=True)
    sorted_by_volume = sorted(stocks, key=lambda x: x["volume"], reverse=True)
    sorted_by_stability = sorted(stocks, key=lambda x: abs(x["change_pct"]))

    return {
        "gainers": sorted_by_change[:10],
        "losers": sorted_by_change[-10:][::-1],
        "active": sorted_by_volume[:10],
        "stable": sorted_by_stability[:10],
    }
