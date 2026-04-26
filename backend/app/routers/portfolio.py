import asyncio
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.auth import get_current_user_id
from app.models import User, Portfolio, Order, OrderSide, TradeReason
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


@router.get("/portfolio/health")
async def get_portfolio_health(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    # Load holdings
    port_result = await db.execute(select(Portfolio).where(Portfolio.user_id == user_id))
    holdings = port_result.scalars().all()

    # Load orders from last 30 days
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    orders_result = await db.execute(
        select(Order).where(Order.user_id == user_id, Order.timestamp >= cutoff)
    )
    recent_orders = orders_result.scalars().all()

    # Load all orders ever for discipline score
    all_orders_result = await db.execute(
        select(Order).where(Order.user_id == user_id)
    )
    all_orders = all_orders_result.scalars().all()

    num_holdings = len(holdings)

    # ── Diversification (25 pts) ──────────────────────────────
    if num_holdings == 0:
        diversification = 15   # all cash is neutral
    elif num_holdings == 1:
        diversification = 5
    elif num_holdings == 2:
        diversification = 10
    elif num_holdings in (3, 4):
        diversification = 18
    else:
        diversification = 25

    # ── Concentration (25 pts) ────────────────────────────────
    if num_holdings == 0:
        concentration = 25
    else:
        total_invested = sum(float(h.avg_buy_price) * h.total_quantity for h in holdings)
        if total_invested == 0:
            concentration = 25
        else:
            max_holding_pct = max(
                (float(h.avg_buy_price) * h.total_quantity / total_invested * 100)
                for h in holdings
            )
            if max_holding_pct < 30:
                concentration = 25
            elif max_holding_pct <= 50:
                concentration = 15
            else:
                concentration = 5

    # ── New user shortcut ─────────────────────────────────────
    if num_holdings == 0 and not all_orders:
        return {
            "score": 0,
            "label": "NEW",
            "breakdown": {"diversification": 0, "concentration": 0, "activity": 0, "discipline": 0},
        }

    # ── Activity (25 pts) ─────────────────────────────────────
    weeks = 4  # 30-day window ≈ 4 weeks
    trades_per_week = len(recent_orders) / weeks if weeks else 0
    if len(recent_orders) == 0:
        activity = 0
    elif trades_per_week <= 5:
        activity = 25
    elif trades_per_week <= 10:
        activity = 15
    else:
        activity = 5

    # ── Discipline (25 pts) ───────────────────────────────────
    if not all_orders:
        discipline = 0
    else:
        with_reason = sum(1 for o in all_orders if o.trade_reason is not None)
        ratio = with_reason / len(all_orders)
        if ratio >= 0.8:
            discipline = 25
        elif ratio >= 0.5:
            discipline = 18
        elif ratio >= 0.25:
            discipline = 10
        else:
            discipline = 3

    score = diversification + concentration + activity + discipline

    if score >= 85:
        label = "DISCIPLINED"
    elif score >= 65:
        label = "CONSISTENT"
    elif score >= 40:
        label = "DEVELOPING"
    else:
        label = "LEARNING"

    return {
        "score": score,
        "label": label,
        "breakdown": {
            "diversification": diversification,
            "concentration": concentration,
            "activity": activity,
            "discipline": discipline,
        },
    }
