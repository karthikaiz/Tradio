import re
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.auth import get_current_user_id
from app.models import User

router = APIRouter(prefix="/api/user", tags=["user"])
logger = logging.getLogger(__name__)

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,20}$")


class UpdateUsernameRequest(BaseModel):
    username: str


@router.get("/profile")
async def get_profile(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    return {"username": user.username}


@router.patch("/username")
async def update_username(
    body: UpdateUsernameRequest,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3–20 characters: letters, numbers, underscores only",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    user.username = username

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Username already taken")

    logger.info(f"User {user_id} set username to '{username}'")
    return {"username": username}
