import logging
from decimal import Decimal
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Challenge, ChallengeParticipant, ChallengePortfolio, ChallengeOrder, OrderSide, OrderStatus
from app.services.market import get_price, MarketDataError
from app.services.trade import round_money, InsufficientBalanceError, InsufficientHoldingsError, NoPositionError

logger = logging.getLogger(__name__)


class ChallengeNotFoundError(Exception):
    pass


class ChallengeNotActiveError(Exception):
    pass


class NotParticipantError(Exception):
    pass


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def _get_active_challenge(db: AsyncSession, challenge_id: int) -> Challenge:
    result = await db.execute(select(Challenge).where(Challenge.id == challenge_id))
    challenge = result.scalar_one_or_none()
    if challenge is None:
        raise ChallengeNotFoundError()
    now = datetime.now(timezone.utc)
    if now < _as_utc(challenge.start_date) or now > _as_utc(challenge.end_date):
        raise ChallengeNotActiveError()
    return challenge


async def challenge_buy(db: AsyncSession, challenge_id: int, user_id: int, ticker: str, quantity: int) -> dict:
    try:
        raw_price = await get_price(ticker)
    except MarketDataError as e:
        raise e

    price = round_money(raw_price)
    total_cost = round_money(price * quantity)

    async with db.begin():
        challenge = await _get_active_challenge(db, challenge_id)

        part_result = await db.execute(
            select(ChallengeParticipant).where(
                ChallengeParticipant.challenge_id == challenge_id,
                ChallengeParticipant.user_id == user_id,
            )
        )
        participant = part_result.scalar_one_or_none()
        if participant is None:
            raise NotParticipantError()

        balance = round_money(participant.balance)
        if total_cost > balance:
            raise InsufficientBalanceError(required=total_cost, available=balance)

        participant.balance = balance - total_cost

        port_result = await db.execute(
            select(ChallengePortfolio).where(
                ChallengePortfolio.challenge_id == challenge_id,
                ChallengePortfolio.user_id == user_id,
                ChallengePortfolio.ticker_symbol == ticker,
            )
        )
        holding = port_result.scalar_one_or_none()

        if holding is None:
            holding = ChallengePortfolio(
                challenge_id=challenge_id,
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

        order = ChallengeOrder(
            challenge_id=challenge_id,
            user_id=user_id,
            ticker_symbol=ticker,
            order_side=OrderSide.BUY,
            quantity=quantity,
            execution_price=price,
            realized_pnl=None,
            status=OrderStatus.EXECUTED,
        )
        db.add(order)

    logger.info(f"CHALLENGE BUY {quantity} {ticker} @ ₹{price} | challenge_id={challenge_id} user_id={user_id}")

    return {
        "order_id": order.id,
        "ticker": ticker,
        "quantity": quantity,
        "execution_price": float(price),
        "total_cost": float(total_cost),
        "new_balance": float(round_money(participant.balance)),
    }


async def challenge_sell(db: AsyncSession, challenge_id: int, user_id: int, ticker: str, quantity: int) -> dict:
    async with db.begin():
        challenge = await _get_active_challenge(db, challenge_id)

        part_result = await db.execute(
            select(ChallengeParticipant).where(
                ChallengeParticipant.challenge_id == challenge_id,
                ChallengeParticipant.user_id == user_id,
            )
        )
        participant = part_result.scalar_one_or_none()
        if participant is None:
            raise NotParticipantError()

        port_result = await db.execute(
            select(ChallengePortfolio).where(
                ChallengePortfolio.challenge_id == challenge_id,
                ChallengePortfolio.user_id == user_id,
                ChallengePortfolio.ticker_symbol == ticker,
            )
        )
        holding = port_result.scalar_one_or_none()
        if holding is None:
            raise NoPositionError(ticker=ticker)
        if quantity > holding.total_quantity:
            raise InsufficientHoldingsError(requested=quantity, available=holding.total_quantity)

        try:
            raw_price = await get_price(ticker)
        except MarketDataError as e:
            raise e

        price = round_money(raw_price)
        proceeds = round_money(price * quantity)
        avg_buy = round_money(holding.avg_buy_price)
        realized_pnl = round_money((price - avg_buy) * quantity)

        participant.balance = round_money(participant.balance) + proceeds

        if holding.total_quantity - quantity == 0:
            await db.delete(holding)
        else:
            holding.total_quantity -= quantity

        order = ChallengeOrder(
            challenge_id=challenge_id,
            user_id=user_id,
            ticker_symbol=ticker,
            order_side=OrderSide.SELL,
            quantity=quantity,
            execution_price=price,
            realized_pnl=realized_pnl,
            status=OrderStatus.EXECUTED,
        )
        db.add(order)

    logger.info(f"CHALLENGE SELL {quantity} {ticker} @ ₹{price} P&L ₹{realized_pnl} | challenge_id={challenge_id} user_id={user_id}")

    return {
        "order_id": order.id,
        "ticker": ticker,
        "quantity": quantity,
        "execution_price": float(price),
        "proceeds": float(proceeds),
        "realized_pnl": float(realized_pnl),
        "new_balance": float(round_money(participant.balance)),
    }
