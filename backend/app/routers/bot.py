"""Read-only bot monitoring endpoints — consumed by the /bot dashboard."""

from datetime import date as _date
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import BotStatus, BotPosition, BotScanResult, BotLog

router = APIRouter(prefix="/api/bot", tags=["bot"])


@router.get("/status")
async def get_bot_status(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BotStatus).order_by(desc(BotStatus.id)).limit(1))
    row = result.scalar_one_or_none()
    if row is None:
        return {
            "status": "STOPPED",
            "climate_score": None,
            "climate_regime": None,
            "circuit_breaker": "OK",
            "last_heartbeat": None,
            "daily_pnl": None,
            "open_positions_count": 0,
        }
    return {
        "status": row.status,
        "climate_score": row.climate_score,
        "climate_regime": row.climate_regime,
        "circuit_breaker": row.circuit_breaker,
        "last_heartbeat": row.last_heartbeat.isoformat() if row.last_heartbeat else None,
        "daily_pnl": row.daily_pnl,
        "open_positions_count": row.open_positions_count,
    }


@router.get("/positions")
async def get_bot_positions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BotPosition).where(BotPosition.is_open == True).order_by(desc(BotPosition.entry_date))
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "ticker": r.ticker,
            "entry_price": r.entry_price,
            "current_price": r.current_price,
            "stop_loss": r.stop_loss,
            "target_1": r.target_1,
            "target_2": r.target_2,
            "quantity": r.quantity,
            "pnl": r.pnl,
            "conviction": r.conviction,
            "thesis": r.thesis,
            "strategy": r.strategy,
            "entry_date": r.entry_date.isoformat() if r.entry_date else None,
            "hold_days_min": r.hold_days_min,
            "hold_days_max": r.hold_days_max,
        }
        for r in rows
    ]


@router.get("/scan-results")
async def get_scan_results(
    date: str = Query(default="today"),
    db: AsyncSession = Depends(get_db),
):
    target_date = str(_date.today()) if date == "today" else date
    result = await db.execute(
        select(BotScanResult)
        .where(BotScanResult.date == target_date)
        .order_by(desc(BotScanResult.fundamental_score))
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "date": r.date,
            "ticker": r.ticker,
            "fundamental_score": r.fundamental_score,
            "tier": r.tier,
            "climate_score": r.climate_score,
            "action": r.action,
            "skip_reason": r.skip_reason,
            "conviction": r.conviction,
            "llm_thesis": r.llm_thesis,
            "recorded_at": r.recorded_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/logs")
async def get_bot_logs(
    limit: int = Query(default=50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(BotLog).order_by(desc(BotLog.timestamp)).limit(limit)
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "timestamp": r.timestamp.isoformat(),
            "level": r.level,
            "message": r.message,
        }
        for r in rows
    ]
