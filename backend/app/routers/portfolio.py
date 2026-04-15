import asyncio
import logging
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.auth import get_current_user_id
from app.models import User, Portfolio, Order, OrderSide
from app.services.market import get_price, MarketDataError
from app.services.trade import round_money

router = APIRouter(prefix="/api", tags=["portfolio"])
logger = logging.getLogger(__name__)


@router.get("/portfolio")
async def get_portfolio(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    # Load user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()

    # Load all holdings
    port_result = await db.execute(select(Portfolio).where(Portfolio.user_id == user_id))
    holdings = port_result.scalars().all()

    # Fetch all prices in parallel
    async def fetch_holding_price(holding):
        try:
            price = await get_price(holding.ticker_symbol)
            return holding, price, None
        except MarketDataError as e:
            return holding, None, e.reason

    price_results = await asyncio.gather(
        *[fetch_holding_price(h) for h in holdings],
        return_exceptions=False,
    )

    # Build holdings response
    holdings_out = []
    total_invested = 0.0
    total_current_value = 0.0

    for holding, price, error in price_results:
        invested = float(round_money(holding.avg_buy_price * holding.total_quantity))
        total_invested += invested

        if price is not None:
            current_val = float(round_money(price * holding.total_quantity))
            unrealized_pnl = float(round_money(current_val - invested))
            unrealized_pnl_pct = round((unrealized_pnl / invested) * 100, 2) if invested else 0.0
            total_current_value += current_val
        else:
            current_val = None
            unrealized_pnl = None
            unrealized_pnl_pct = None
            total_current_value += invested  # fallback to cost basis

        holdings_out.append({
            "ticker": holding.ticker_symbol,
            "quantity": holding.total_quantity,
            "avg_buy_price": float(round_money(holding.avg_buy_price)),
            "current_price": round(price, 2) if price else None,
            "invested_value": invested,
            "current_value": current_val,
            "unrealized_pnl": unrealized_pnl,
            "unrealized_pnl_pct": unrealized_pnl_pct,
            "error": error,
        })

    # Total realized P&L from all SELL orders
    pnl_result = await db.execute(
        select(func.sum(Order.realized_pnl)).where(
            Order.user_id == user_id,
            Order.order_side == OrderSide.SELL,
            Order.realized_pnl.isnot(None),
        )
    )
    total_realized_pnl = float(round_money(pnl_result.scalar() or 0))

    total_unrealized_pnl = float(round_money(total_current_value - total_invested))
    total_unrealized_pnl_pct = (
        round((total_unrealized_pnl / total_invested) * 100, 2) if total_invested else 0.0
    )

    return {
        "available_balance": float(round_money(user.virtual_balance)),
        "total_invested": round(total_invested, 2),
        "total_current_value": round(total_current_value, 2),
        "total_unrealized_pnl": total_unrealized_pnl,
        "total_unrealized_pnl_pct": total_unrealized_pnl_pct,
        "total_realized_pnl": total_realized_pnl,
        "holdings": holdings_out,
    }
