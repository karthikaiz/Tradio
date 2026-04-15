import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.auth import get_current_user_id
from app.services.market import MarketDataError
from app.services.trade import (
    execute_buy,
    execute_sell,
    InsufficientBalanceError,
    InsufficientHoldingsError,
    NoPositionError,
)

router = APIRouter(prefix="/api/trade", tags=["trade"])
logger = logging.getLogger(__name__)


class TradeRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    quantity: int = Field(..., gt=0)


@router.post("/buy")
async def buy(
    req: TradeRequest,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    ticker = req.ticker.upper().strip()
    try:
        result = await execute_buy(db, ticker, req.quantity, user_id)
        return result
    except MarketDataError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "Market data unavailable", "ticker": ticker, "reason": e.reason},
        )
    except InsufficientBalanceError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Insufficient balance",
                "required": float(e.required),
                "available": float(e.available),
            },
        )


@router.post("/sell")
async def sell(
    req: TradeRequest,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    ticker = req.ticker.upper().strip()
    try:
        result = await execute_sell(db, ticker, req.quantity, user_id)
        return result
    except MarketDataError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "Market data unavailable", "ticker": ticker, "reason": e.reason},
        )
    except NoPositionError as e:
        raise HTTPException(
            status_code=400,
            detail={"error": "No position found", "ticker": e.ticker},
        )
    except InsufficientHoldingsError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Insufficient holdings",
                "requested": e.requested,
                "available": e.available,
            },
        )
