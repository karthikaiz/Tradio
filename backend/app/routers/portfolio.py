import asyncio
import logging
import math
from collections import defaultdict
from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
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
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

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
        return_exceptions=True,
    )

    # Build holdings response
    holdings_out = []
    total_invested = 0.0
    total_current_value = 0.0

    for item in price_results:
        if isinstance(item, Exception):
            logger.error("Price fetch failed unexpectedly: %s", item)
            continue
        holding, price, error = item
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


@router.get("/portfolio/history")
async def get_portfolio_history(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """Return daily portfolio value history using actual yfinance closing prices."""
    import yfinance as yf

    STARTING_BALANCE = 100_000.0

    orders_result = await db.execute(
        select(Order).where(Order.user_id == user_id).order_by(Order.timestamp)
    )
    orders = orders_result.scalars().all()

    if not orders:
        return {"points": []}

    first_dt = orders[0].timestamp.date()
    end_dt = date.today() + timedelta(days=1)
    tickers = list({o.ticker_symbol for o in orders})

    def fetch_histories() -> dict[str, dict[str, float]]:
        result: dict[str, dict[str, float]] = {}
        for ticker in tickers:
            ticker_ns = ticker if ticker.startswith("^") else f"{ticker}.NS"
            try:
                hist = yf.Ticker(ticker_ns).history(
                    start=first_dt.isoformat(),
                    end=end_dt.isoformat(),
                    auto_adjust=True,
                )
                result[ticker] = {}
                for ts, row in hist.iterrows():
                    close = row.get("Close")
                    if close is not None and not math.isnan(float(close)) and float(close) > 0:
                        result[ticker][str(ts.date())] = float(close)
            except Exception:
                result[ticker] = {}
        return result

    loop = asyncio.get_event_loop()
    price_history = await loop.run_in_executor(None, fetch_histories)

    # Group orders by date string
    orders_by_date: dict[str, list] = defaultdict(list)
    for o in orders:
        orders_by_date[str(o.timestamp.date())].append(o)

    # Collect all trading dates that yfinance returned across any ticker
    all_dates = sorted({
        d
        for prices in price_history.values()
        for d in prices
        if d >= str(first_dt)
    })

    cash = STARTING_BALANCE
    holdings: dict[str, dict] = {}  # {ticker: {qty, avgPrice}}
    last_price: dict[str, float] = {}

    points = []
    for date_str in all_dates:
        for o in orders_by_date.get(date_str, []):
            qty = o.quantity
            exec_price = float(o.execution_price)
            ticker = o.ticker_symbol

            if o.order_side == OrderSide.BUY:
                cash -= qty * exec_price
                prev = holdings.get(ticker, {"qty": 0, "avgPrice": 0.0})
                new_qty = prev["qty"] + qty
                holdings[ticker] = {
                    "qty": new_qty,
                    "avgPrice": (prev["qty"] * prev["avgPrice"] + qty * exec_price) / new_qty,
                }
            else:
                cash += qty * exec_price
                prev = holdings.get(ticker)
                if prev:
                    remaining = prev["qty"] - qty
                    if remaining <= 0:
                        holdings.pop(ticker, None)
                    else:
                        holdings[ticker] = {"qty": remaining, "avgPrice": prev["avgPrice"]}

        holdings_val = 0.0
        for ticker, h in holdings.items():
            price = price_history.get(ticker, {}).get(date_str)
            if price is not None:
                last_price[ticker] = price
            else:
                price = last_price.get(ticker, h["avgPrice"])
            holdings_val += h["qty"] * price

        # Use noon IST (06:30 UTC) as the canonical daily timestamp
        d = date.fromisoformat(date_str)
        ts = int(datetime(d.year, d.month, d.day, 6, 30, 0, tzinfo=timezone.utc).timestamp())
        points.append({"time": ts, "value": round(cash + holdings_val)})

    # Append live endpoint using current balance + live market prices
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    port_result = await db.execute(select(Portfolio).where(Portfolio.user_id == user_id))
    live_holdings = port_result.scalars().all()

    if user and live_holdings:
        live_holdings_val = sum(
            last_price.get(h.ticker_symbol, float(h.avg_buy_price)) * h.total_quantity
            for h in live_holdings
        )
        live_total = float(user.virtual_balance) + live_holdings_val
        live_ts = int(datetime.now(timezone.utc).timestamp())
        if not points or live_ts > points[-1]["time"]:
            points.append({"time": live_ts, "value": round(live_total)})

    return {"points": points}
