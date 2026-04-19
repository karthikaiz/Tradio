import asyncio
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.auth import get_current_user_id
from app.models import Challenge, ChallengeParticipant, ChallengePortfolio, ChallengeOrder, OrderSide, User
from app.services.market import get_price, MarketDataError
from app.services.trade import round_money
from app.services.challenge_trade import (
    challenge_buy,
    challenge_sell,
    ChallengeNotFoundError,
    ChallengeNotActiveError,
    NotParticipantError,
    InsufficientBalanceError,
    InsufficientHoldingsError,
    NoPositionError,
)

router = APIRouter(prefix="/api/challenges", tags=["challenges"])
logger = logging.getLogger(__name__)


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateChallengeRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=100)
    starting_balance: float = Field(..., gt=0, le=10_000_000)
    start_date: datetime
    end_date: datetime


class TradeRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    quantity: int = Field(..., gt=0)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _challenge_status(challenge: Challenge) -> str:
    now = datetime.now(timezone.utc)
    if now < _as_utc(challenge.start_date):
        return "upcoming"
    if now > _as_utc(challenge.end_date):
        return "ended"
    return "active"


def _serialize_challenge(challenge: Challenge, participant_count: int) -> dict:
    return {
        "id": challenge.id,
        "name": challenge.name,
        "creator_id": challenge.creator_id,
        "starting_balance": float(challenge.starting_balance),
        "start_date": challenge.start_date.isoformat(),
        "end_date": challenge.end_date.isoformat(),
        "created_at": challenge.created_at.isoformat(),
        "status": _challenge_status(challenge),
        "participant_count": participant_count,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_challenge(
    req: CreateChallengeRequest,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    if req.end_date <= req.start_date:
        raise HTTPException(status_code=400, detail={"error": "end_date must be after start_date"})
    if req.end_date <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail={"error": "end_date must be in the future"})

    challenge = Challenge(
        name=req.name,
        creator_id=user_id,
        starting_balance=req.starting_balance,
        start_date=req.start_date,
        end_date=req.end_date,
    )
    db.add(challenge)
    await db.commit()
    await db.refresh(challenge)

    return _serialize_challenge(challenge, 0)


@router.get("")
async def list_challenges(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Challenge).order_by(Challenge.created_at.desc()).offset(offset).limit(limit)
    )
    challenges = result.scalars().all()

    counts = {}
    if challenges:
        ids = [c.id for c in challenges]
        count_result = await db.execute(
            select(ChallengeParticipant.challenge_id, func.count().label("cnt"))
            .where(ChallengeParticipant.challenge_id.in_(ids))
            .group_by(ChallengeParticipant.challenge_id)
        )
        counts = {row.challenge_id: row.cnt for row in count_result}

    return {
        "challenges": [_serialize_challenge(c, counts.get(c.id, 0)) for c in challenges],
        "total": len(challenges),
    }


@router.get("/{challenge_id}")
async def get_challenge(
    challenge_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Challenge).where(Challenge.id == challenge_id))
    challenge = result.scalar_one_or_none()
    if challenge is None:
        raise HTTPException(status_code=404, detail={"error": "Challenge not found"})

    count_result = await db.execute(
        select(func.count()).where(ChallengeParticipant.challenge_id == challenge_id)
    )
    count = count_result.scalar() or 0

    return _serialize_challenge(challenge, count)


@router.post("/{challenge_id}/join", status_code=201)
async def join_challenge(
    challenge_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(select(Challenge).where(Challenge.id == challenge_id))
    challenge = result.scalar_one_or_none()
    if challenge is None:
        raise HTTPException(status_code=404, detail={"error": "Challenge not found"})

    now = datetime.now(timezone.utc)
    if now > _as_utc(challenge.end_date):
        raise HTTPException(status_code=400, detail={"error": "Challenge has already ended"})

    existing = await db.execute(
        select(ChallengeParticipant).where(
            ChallengeParticipant.challenge_id == challenge_id,
            ChallengeParticipant.user_id == user_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail={"error": "Already joined this challenge"})

    participant = ChallengeParticipant(
        challenge_id=challenge_id,
        user_id=user_id,
        balance=challenge.starting_balance,
    )
    from sqlalchemy.exc import IntegrityError
    db.add(participant)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail={"error": "Already joined this challenge"})

    return {"joined": True, "balance": float(challenge.starting_balance)}


@router.get("/{challenge_id}/leaderboard")
async def challenge_leaderboard(
    challenge_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Challenge).where(Challenge.id == challenge_id))
    challenge = result.scalar_one_or_none()
    if challenge is None:
        raise HTTPException(status_code=404, detail={"error": "Challenge not found"})

    parts_result = await db.execute(
        select(ChallengeParticipant)
        .where(ChallengeParticipant.challenge_id == challenge_id)
    )
    participants = parts_result.scalars().all()

    if not participants:
        return {"entries": [], "challenge_id": challenge_id}

    user_ids = [p.user_id for p in participants]
    users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    users_map = {u.id: u for u in users_result.scalars().all()}

    holdings_result = await db.execute(
        select(ChallengePortfolio).where(ChallengePortfolio.challenge_id == challenge_id)
    )
    all_holdings = holdings_result.scalars().all()
    holdings_by_user: dict[int, list[ChallengePortfolio]] = {}
    for h in all_holdings:
        holdings_by_user.setdefault(h.user_id, []).append(h)

    all_tickers = {h.ticker_symbol for h in all_holdings}

    async def fetch_safe(ticker: str) -> tuple[str, float | None]:
        try:
            return ticker, await get_price(ticker)
        except MarketDataError:
            return ticker, None

    price_results = await asyncio.gather(*[fetch_safe(t) for t in all_tickers])
    prices: dict[str, float | None] = dict(price_results)

    starting = float(challenge.starting_balance)
    entries = []
    for p in participants:
        holdings = holdings_by_user.get(p.user_id, [])
        holdings_value = sum(
            float(round_money((prices.get(h.ticker_symbol) or float(h.avg_buy_price)) * h.total_quantity))
            for h in holdings
        )
        total_value = float(round_money(float(p.balance) + holdings_value))
        total_pnl = float(round_money(total_value - starting))
        total_pnl_pct = round((total_pnl / starting) * 100, 2) if starting else 0.0
        user = users_map.get(p.user_id)
        entries.append({
            "user_id": p.user_id,
            "username": user.username if user else str(p.user_id),
            "total_value": total_value,
            "total_pnl": total_pnl,
            "total_pnl_pct": total_pnl_pct,
        })

    entries.sort(key=lambda e: e["total_pnl_pct"], reverse=True)
    ranked = [{"rank": i + 1, **e} for i, e in enumerate(entries)]

    return {"entries": ranked, "challenge_id": challenge_id}


@router.get("/{challenge_id}/portfolio")
async def challenge_portfolio(
    challenge_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(select(Challenge).where(Challenge.id == challenge_id))
    challenge = result.scalar_one_or_none()
    if challenge is None:
        raise HTTPException(status_code=404, detail={"error": "Challenge not found"})

    part_result = await db.execute(
        select(ChallengeParticipant).where(
            ChallengeParticipant.challenge_id == challenge_id,
            ChallengeParticipant.user_id == user_id,
        )
    )
    participant = part_result.scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=404, detail={"error": "Not a participant"})

    holdings_result = await db.execute(
        select(ChallengePortfolio).where(
            ChallengePortfolio.challenge_id == challenge_id,
            ChallengePortfolio.user_id == user_id,
        )
    )
    holdings = holdings_result.scalars().all()

    async def fetch_holding_price(holding):
        try:
            price = await get_price(holding.ticker_symbol)
            return holding, price, None
        except MarketDataError as e:
            return holding, None, e.reason

    price_results = await asyncio.gather(*[fetch_holding_price(h) for h in holdings])

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
            total_current_value += invested

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

    from sqlalchemy import func as sqlfunc
    pnl_result = await db.execute(
        select(sqlfunc.sum(ChallengeOrder.realized_pnl)).where(
            ChallengeOrder.challenge_id == challenge_id,
            ChallengeOrder.user_id == user_id,
            ChallengeOrder.order_side == OrderSide.SELL,
            ChallengeOrder.realized_pnl.isnot(None),
        )
    )
    total_realized_pnl = float(round_money(pnl_result.scalar() or 0))
    total_unrealized_pnl = float(round_money(total_current_value - total_invested))
    total_unrealized_pnl_pct = round((total_unrealized_pnl / total_invested) * 100, 2) if total_invested else 0.0

    return {
        "available_balance": float(round_money(participant.balance)),
        "starting_balance": float(challenge.starting_balance),
        "total_invested": round(total_invested, 2),
        "total_current_value": round(total_current_value, 2),
        "total_unrealized_pnl": total_unrealized_pnl,
        "total_unrealized_pnl_pct": total_unrealized_pnl_pct,
        "total_realized_pnl": total_realized_pnl,
        "holdings": holdings_out,
    }


@router.get("/{challenge_id}/orders")
async def challenge_orders(
    challenge_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(ChallengeOrder)
        .where(
            ChallengeOrder.challenge_id == challenge_id,
            ChallengeOrder.user_id == user_id,
        )
        .order_by(ChallengeOrder.timestamp.desc())
        .offset(offset)
        .limit(limit)
    )
    orders = result.scalars().all()
    return [
        {
            "order_id": o.id,
            "ticker": o.ticker_symbol,
            "side": o.order_side.value,
            "quantity": o.quantity,
            "execution_price": float(o.execution_price),
            "realized_pnl": float(o.realized_pnl) if o.realized_pnl is not None else None,
            "status": o.status.value,
            "timestamp": o.timestamp.isoformat(),
        }
        for o in orders
    ]


@router.post("/{challenge_id}/buy")
async def challenge_buy_endpoint(
    challenge_id: int,
    req: TradeRequest,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    ticker = req.ticker.upper().strip()
    try:
        result = await challenge_buy(db, challenge_id, user_id, ticker, req.quantity)
        return result
    except ChallengeNotFoundError:
        raise HTTPException(status_code=404, detail={"error": "Challenge not found"})
    except ChallengeNotActiveError:
        raise HTTPException(status_code=400, detail={"error": "Challenge is not currently active"})
    except NotParticipantError:
        raise HTTPException(status_code=403, detail={"error": "You must join the challenge first"})
    except MarketDataError as e:
        raise HTTPException(status_code=503, detail={"error": "Market data unavailable", "ticker": ticker, "reason": e.reason})
    except InsufficientBalanceError as e:
        raise HTTPException(status_code=400, detail={"error": "Insufficient balance", "required": float(e.required), "available": float(e.available)})


@router.post("/{challenge_id}/sell")
async def challenge_sell_endpoint(
    challenge_id: int,
    req: TradeRequest,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    ticker = req.ticker.upper().strip()
    try:
        result = await challenge_sell(db, challenge_id, user_id, ticker, req.quantity)
        return result
    except ChallengeNotFoundError:
        raise HTTPException(status_code=404, detail={"error": "Challenge not found"})
    except ChallengeNotActiveError:
        raise HTTPException(status_code=400, detail={"error": "Challenge is not currently active"})
    except NotParticipantError:
        raise HTTPException(status_code=403, detail={"error": "You must join the challenge first"})
    except MarketDataError as e:
        raise HTTPException(status_code=503, detail={"error": "Market data unavailable", "ticker": ticker, "reason": e.reason})
    except NoPositionError as e:
        raise HTTPException(status_code=400, detail={"error": "No position found", "ticker": e.ticker})
    except InsufficientHoldingsError as e:
        raise HTTPException(status_code=400, detail={"error": "Insufficient holdings", "requested": e.requested, "available": e.available})


@router.get("/{challenge_id}/me")
async def challenge_me(
    challenge_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """Check if the current user is a participant."""
    part_result = await db.execute(
        select(ChallengeParticipant).where(
            ChallengeParticipant.challenge_id == challenge_id,
            ChallengeParticipant.user_id == user_id,
        )
    )
    participant = part_result.scalar_one_or_none()
    return {"joined": participant is not None}
