"""
Supabase JWT authentication via /auth/v1/user endpoint.
Auto-provisions new users with ₹1,00,000 virtual balance on first login.
"""
import logging
import os
from decimal import Decimal

import httpx
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User

logger = logging.getLogger(__name__)

SUPABASE_PROJECT_REF = os.getenv("SUPABASE_PROJECT_REF", "etnpvqalehpzdrrzugmn")
SUPABASE_URL = f"https://{SUPABASE_PROJECT_REF}.supabase.co"
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")


async def get_current_user_id(
    authorization: str = Header(..., description="Bearer <supabase_jwt>"),
    db: AsyncSession = Depends(get_db),
) -> int:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    if not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=503, detail="Auth not configured")

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": authorization,
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid token")

        supabase_id: str = resp.json()["id"]

    except httpx.HTTPError as e:
        logger.error(f"Failed to verify token with Supabase: {e}")
        raise HTTPException(status_code=503, detail="Auth service unavailable")

    async with db.begin():
        result = await db.execute(select(User).where(User.clerk_id == supabase_id))
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                clerk_id=supabase_id,
                username=supabase_id[:50],
                virtual_balance=Decimal("100000.00"),
            )
            db.add(user)
            await db.flush()
            logger.info(f"Auto-provisioned new user supabase_id={supabase_id}")

    return user.id
