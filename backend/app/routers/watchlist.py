import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.auth import get_current_user_id
from app.models import Watchlist

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])
logger = logging.getLogger(__name__)

DEFAULT_TICKERS = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "SBIN"]


class AddTickerRequest(BaseModel):
    ticker: str


@router.get("")
async def get_watchlist(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(Watchlist.ticker_symbol)
        .where(Watchlist.user_id == user_id)
        .order_by(Watchlist.added_at)
    )
    tickers = result.scalars().all()
    return {"tickers": list(tickers)}


@router.post("", status_code=201)
async def add_to_watchlist(
    body: AddTickerRequest,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    ticker = body.ticker.upper().strip()
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker cannot be empty")

    entry = Watchlist(user_id=user_id, ticker_symbol=ticker)
    db.add(entry)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"{ticker} is already in your watchlist")

    return {"ticker": ticker}


@router.delete("/{ticker}", status_code=204)
async def remove_from_watchlist(
    ticker: str,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    ticker = ticker.upper().strip()
    result = await db.execute(
        delete(Watchlist)
        .where(Watchlist.user_id == user_id, Watchlist.ticker_symbol == ticker)
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"{ticker} not in your watchlist")
