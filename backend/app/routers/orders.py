import logging
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.auth import get_current_user_id
from app.models import Order

router = APIRouter(prefix="/api", tags=["orders"])
logger = logging.getLogger(__name__)


@router.get("/orders")
async def get_orders(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(Order)
        .where(Order.user_id == user_id)
        .order_by(Order.timestamp.desc())
        .limit(limit)
        .offset(offset)
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
