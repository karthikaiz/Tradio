import asyncio
import logging
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models import User
from app.services.market import get_price, MarketDataError
from app.services.trade import round_money

router = APIRouter(prefix="/api", tags=["leaderboard"])
logger = logging.getLogger(__name__)

STARTING_BALANCE = 100_000.0


@router.get("/leaderboard")
async def get_leaderboard(
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).options(selectinload(User.portfolio))
    )
    users = result.scalars().all()

    all_tickers = {h.ticker_symbol for u in users for h in u.portfolio}

    async def fetch_price_safe(ticker: str) -> tuple[str, float | None]:
        try:
            return ticker, await get_price(ticker)
        except MarketDataError:
            return ticker, None

    price_results = await asyncio.gather(*[fetch_price_safe(t) for t in all_tickers])
    prices: dict[str, float | None] = dict(price_results)

    entries = []
    for user in users:
        holdings_value = sum(
            float(round_money((prices.get(h.ticker_symbol) or float(h.avg_buy_price)) * h.total_quantity))
            for h in user.portfolio
        )
        total_value = float(round_money(float(user.virtual_balance) + holdings_value))
        total_pnl = float(round_money(total_value - STARTING_BALANCE))
        total_pnl_pct = round((total_pnl / STARTING_BALANCE) * 100, 2)

        entries.append({
            "username": user.username,
            "total_value": total_value,
            "total_pnl": total_pnl,
            "total_pnl_pct": total_pnl_pct,
        })

    entries.sort(key=lambda e: (e["total_pnl_pct"], e["total_value"]), reverse=True)

    ranked = [{"rank": i + 1, **entry} for i, entry in enumerate(entries[:limit])]

    return {"entries": ranked, "total_users": len(users)}
