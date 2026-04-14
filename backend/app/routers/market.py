import logging
from fastapi import APIRouter, HTTPException, Query
from app.services.market import get_price, get_cache_info, MarketDataError

router = APIRouter(prefix="/api/market", tags=["market"])
logger = logging.getLogger(__name__)


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
