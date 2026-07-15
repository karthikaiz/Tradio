import logging
import os
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import User, Portfolio, Order, OrderSide, OrderStatus, TradeReason
from app.services.market import get_price, MarketDataError

logger = logging.getLogger(__name__)

CENT = Decimal("0.01")

# Paper-fill slippage in basis points: buys fill above the quote, sells below,
# mimicking real spread + impact so paper results don't flatter live trading.
# Default 0 keeps existing behaviour/tests; production sets ~5 bps via env.
PAPER_SLIPPAGE_BPS = float(os.getenv("PAPER_SLIPPAGE_BPS", "0"))


def round_money(value: float | Decimal) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def _slip(raw_price: float, side: OrderSide) -> float:
    if PAPER_SLIPPAGE_BPS <= 0:
        return raw_price
    factor = 1 + PAPER_SLIPPAGE_BPS / 10_000 * (1 if side == OrderSide.BUY else -1)
    return raw_price * factor


async def execute_buy(db: AsyncSession, ticker: str, quantity: int, user_id: int, trade_reason: TradeReason | None = None) -> dict:
    # 1. Fetch price
    try:
        raw_price = await get_price(ticker)
    except MarketDataError as e:
        raise e

    price = round_money(_slip(raw_price, OrderSide.BUY))
    total_cost = round_money(price * quantity)

    async with db.begin():
        # 2. Load user
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one()

        balance = round_money(user.virtual_balance)

        # 3. Check balance
        if total_cost > balance:
            raise InsufficientBalanceError(required=total_cost, available=balance)

        # 4. Deduct balance
        user.virtual_balance = balance - total_cost

        # 5. Upsert portfolio
        port_result = await db.execute(
            select(Portfolio).where(
                Portfolio.user_id == user_id,
                Portfolio.ticker_symbol == ticker,
            )
        )
        holding = port_result.scalar_one_or_none()

        if holding is None:
            holding = Portfolio(
                user_id=user_id,
                ticker_symbol=ticker,
                total_quantity=quantity,
                avg_buy_price=price,
            )
            db.add(holding)
        else:
            existing_qty = holding.total_quantity
            existing_avg = round_money(holding.avg_buy_price)
            new_avg = round_money(
                (existing_qty * existing_avg + quantity * price) / (existing_qty + quantity)
            )
            holding.total_quantity = existing_qty + quantity
            holding.avg_buy_price = new_avg

        # 6. Record order
        order = Order(
            user_id=user_id,
            ticker_symbol=ticker,
            order_side=OrderSide.BUY,
            quantity=quantity,
            execution_price=price,
            realized_pnl=None,
            status=OrderStatus.EXECUTED,
            trade_reason=trade_reason,
        )
        db.add(order)

    logger.info(f"BUY {quantity} {ticker} @ ₹{price} | user_id={user_id} | new balance ₹{user.virtual_balance}")

    return {
        "order_id": order.id,
        "ticker": ticker,
        "quantity": quantity,
        "execution_price": float(price),
        "total_cost": float(total_cost),
        "new_balance": float(round_money(user.virtual_balance)),
    }


async def execute_sell(db: AsyncSession, ticker: str, quantity: int, user_id: int, trade_reason: TradeReason | None = None) -> dict:
    # 1. Check holdings first (before hitting market data)
    async with db.begin():
        port_result = await db.execute(
            select(Portfolio).where(
                Portfolio.user_id == user_id,
                Portfolio.ticker_symbol == ticker,
            )
        )
        holding = port_result.scalar_one_or_none()

        if holding is None:
            raise NoPositionError(ticker=ticker)

        if quantity > holding.total_quantity:
            raise InsufficientHoldingsError(
                requested=quantity, available=holding.total_quantity
            )

        # 2. Fetch price
        try:
            raw_price = await get_price(ticker)
        except MarketDataError as e:
            raise e

        price = round_money(_slip(raw_price, OrderSide.SELL))
        proceeds = round_money(price * quantity)
        avg_buy = round_money(holding.avg_buy_price)
        realized_pnl = round_money((price - avg_buy) * quantity)

        # 3. Load user and credit balance
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one()
        user.virtual_balance = round_money(user.virtual_balance) + proceeds

        # 4. Update portfolio
        if holding.total_quantity - quantity == 0:
            await db.delete(holding)
        else:
            holding.total_quantity -= quantity

        # 5. Record order
        order = Order(
            user_id=user_id,
            ticker_symbol=ticker,
            order_side=OrderSide.SELL,
            quantity=quantity,
            execution_price=price,
            realized_pnl=realized_pnl,
            status=OrderStatus.EXECUTED,
            trade_reason=trade_reason,
        )
        db.add(order)

    logger.info(
        f"SELL {quantity} {ticker} @ ₹{price} | P&L ₹{realized_pnl} | user_id={user_id} | new balance ₹{user.virtual_balance}"
    )

    return {
        "order_id": order.id,
        "ticker": ticker,
        "quantity": quantity,
        "execution_price": float(price),
        "proceeds": float(proceeds),
        "realized_pnl": float(realized_pnl),
        "new_balance": float(round_money(user.virtual_balance)),
    }


class InsufficientBalanceError(Exception):
    def __init__(self, required: Decimal, available: Decimal):
        self.required = required
        self.available = available


class InsufficientHoldingsError(Exception):
    def __init__(self, requested: int, available: int):
        self.requested = requested
        self.available = available


class NoPositionError(Exception):
    def __init__(self, ticker: str):
        self.ticker = ticker
