"""
Supabase JWT authentication.
Verifies Bearer tokens using Supabase's JWKS public key.
Auto-provisions new users with ₹1,00,000 virtual balance on first login.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User

logger = logging.getLogger(__name__)

SUPABASE_PROJECT_REF = os.getenv("SUPABASE_PROJECT_REF", "etnpvqalehpzdrrzugmn")
SUPABASE_JWKS_URL = os.getenv(
    "SUPABASE_JWKS_URL",
    f"https://{SUPABASE_PROJECT_REF}.supabase.co/auth/v1/jwks",
)

_jwks_cache: dict | None = None
_jwks_fetched_at: datetime | None = None
_JWKS_TTL = timedelta(hours=1)


async def _get_jwks() -> dict:
    global _jwks_cache, _jwks_fetched_at
    now = datetime.now(timezone.utc)
    if _jwks_cache and _jwks_fetched_at and (now - _jwks_fetched_at) < _JWKS_TTL:
        return _jwks_cache

    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(SUPABASE_JWKS_URL)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_fetched_at = now
        return _jwks_cache


async def get_current_user_id(
    authorization: str = Header(..., description="Bearer <supabase_jwt>"),
    db: AsyncSession = Depends(get_db),
) -> int:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization[7:]

    try:
        jwks = await _get_jwks()

        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if key is None:
            raise HTTPException(status_code=401, detail="Token signing key not found")

        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
        supabase_id: str = payload["sub"]

    except JWTError as e:
        logger.warning(f"JWT verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except httpx.HTTPError as e:
        logger.error(f"Failed to fetch JWKS: {e}")
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
            logger.info(f"Auto-provisioned new user supabase_id={supabase_id} with ₹1,00,000 balance")

    return user.id
