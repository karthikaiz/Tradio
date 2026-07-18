import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from app.services.angel_client import angel_session
from app.services.instruments import get_token, get_name, get_tokens_batch
from app.services.market import get_price, get_cache_info, MarketDataError
from app.services.market_hours import get_market_status

router = APIRouter(prefix="/api/market", tags=["market"])
logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

NSE_LARGECAPS = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "BHARTIARTL",
    "ICICIBANK", "SBIN", "HINDUNILVR", "ITC", "KOTAKBANK",
    "LT", "AXISBANK", "BAJFINANCE", "ASIANPAINT", "MARUTI",
    "WIPRO", "ULTRACEMCO", "TITAN", "SUNPHARMA", "NESTLEIND",
    "POWERGRID", "NTPC", "TECHM", "HCLTECH", "ONGC",
    "JSWSTEEL", "TATAMOTORS", "TATASTEEL", "ADANIENT", "ADANIPORTS",
]

VALID_PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y"}

PERIOD_CONFIG = {
    "1d":  {"days": 1,   "interval": "FIVE_MINUTE"},
    "5d":  {"days": 5,   "interval": "FIFTEEN_MINUTE"},
    "1mo": {"days": 30,  "interval": "ONE_DAY"},
    "3mo": {"days": 90,  "interval": "ONE_DAY"},
    "6mo": {"days": 180, "interval": "ONE_DAY"},
    "1y":  {"days": 365, "interval": "ONE_DAY"},
}


def _date_range(period: str) -> tuple[str, str]:
    now = datetime.now(IST)
    days = PERIOD_CONFIG[period]["days"]
    from_dt = now - timedelta(days=days)
    fmt = "%Y-%m-%d %H:%M"
    return from_dt.strftime(fmt), now.strftime(fmt)


def _parse_candle_ts(ts_str: str) -> int:
    # "2024-01-01T09:15:00+05:30" → unix timestamp
    try:
        dt = datetime.fromisoformat(ts_str)
        return int(dt.timestamp())
    except Exception:
        return 0


@router.get("/status")
async def market_status():
    return get_market_status()


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


@router.get("/history")
async def get_history(ticker: str = Query(...), period: str = Query("1d")):
    ticker = ticker.upper().strip()
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"Invalid period. Use one of: {VALID_PERIODS}")

    token = await get_token(ticker)
    if not token:
        raise HTTPException(status_code=404, detail={"error": "Symbol not found", "ticker": ticker})

    from_date, to_date = _date_range(period)
    interval = PERIOD_CONFIG[period]["interval"]

    try:
        client = await angel_session.client()
        loop = asyncio.get_event_loop()

        def _fetch():
            return client.getCandleData({
                "exchange": "NSE",
                "symboltoken": token,
                "interval": interval,
                "fromdate": from_date,
                "todate": to_date,
            })

        resp = await loop.run_in_executor(None, _fetch)
        if not resp.get("status"):
            raise HTTPException(status_code=503, detail={"error": "Historical data unavailable", "ticker": ticker})

        raw = resp.get("data") or []
        candles = [
            {
                "time": _parse_candle_ts(row[0]),
                "open": round(float(row[1]), 2),
                "high": round(float(row[2]), 2),
                "low": round(float(row[3]), 2),
                "close": round(float(row[4]), 2),
                "volume": int(row[5]),
            }
            for row in raw
        ]
        return {"ticker": ticker, "period": period, "interval": interval, "candles": candles}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"History fetch error for {ticker}: {e}")
        raise HTTPException(status_code=503, detail={"error": str(e), "ticker": ticker})


@router.get("/search")
async def search_tickers(q: str = Query(..., min_length=2)):
    try:
        client = await angel_session.client()
        loop = asyncio.get_event_loop()

        def _fetch():
            return client.searchScrip("NSE", q)

        resp = await loop.run_in_executor(None, _fetch)
        if not resp.get("status"):
            return {"results": []}

        raw = resp.get("data") or []
        seen: set[str] = set()
        results = []
        for item in raw:
            if item.get("exchange") != "NSE":
                continue
            sym_raw: str = item.get("tradingsymbol", "")
            sym = sym_raw.replace("-EQ", "").upper()
            if not sym or sym in seen:
                continue
            seen.add(sym)
            name = await get_name(sym) or sym
            results.append({"ticker": sym, "name": name, "exchange": "NSE"})

        return {"results": results}
    except Exception as e:
        logger.warning(f"Search error for '{q}': {e}")
        return {"results": []}


@router.get("/categories")
async def get_market_categories():
    """
    Returns top gainers, losers, most active, and stable stocks
    from NSE large-caps via a single batch SmartAPI call.
    """
    token_dict = await get_tokens_batch(NSE_LARGECAPS)
    if not token_dict:
        return {"gainers": [], "losers": [], "active": [], "stable": []}

    ticker_by_token = {v: k for k, v in token_dict.items()}
    token_list = list(token_dict.values())

    try:
        client = await angel_session.client()
        loop = asyncio.get_event_loop()

        def _fetch():
            return client.getMarketData("FULL", {"NSE": token_list})

        resp = await loop.run_in_executor(None, _fetch)
        if not resp.get("status"):
            return {"gainers": [], "losers": [], "active": [], "stable": []}

        fetched = resp.get("data", {}).get("fetched", [])
    except Exception as e:
        logger.error(f"Categories fetch error: {e}")
        return {"gainers": [], "losers": [], "active": [], "stable": []}

    stocks = []
    for d in fetched:
        raw_token = str(d.get("symbolToken", ""))
        ticker = ticker_by_token.get(raw_token)
        if not ticker:
            continue
        price = d.get("ltp")
        if price is None:
            continue
        stocks.append({
            "ticker": ticker,
            "name": d.get("tradingSymbol", ticker).replace("-EQ", ""),
            "price": round(float(price), 2),
            "change": round(float(d.get("netChange", 0)), 2),
            "change_pct": round(float(d.get("percentChange", 0)), 2),
            "volume": int(d.get("tradeVolume", 0)),
        })

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
