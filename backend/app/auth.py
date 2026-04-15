"""
Clerk JWT authentication middleware.
Verifies Bearer tokens using Clerk's JWKS public key.
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

CLERK_JWKS_URL = os.getenv(
    "CLERK_JWKS_URL",
    "https://optimal-halibut-61.clerk.accounts.dev/.well-known/jwks.json",
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
        resp = await client.get(CLERK_JWKS_URL)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_fetched_at = now
        return _jwks_cache


async def get_current_user_id(
    authorization: str = Header(..., description="Bearer <clerk_jwt>"),
    db: AsyncSession = Depends(get_db),
) -> int:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization[7:]

    try:
        jwks = await _get_jwks()

        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        # Find matching public key
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if key is None:
            raise HTTPException(status_code=401, detail="Token signing key not found")

        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
        clerk_id: str = payload["sub"]

    except JWTError as e:
        logger.warning(f"JWT verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except httpx.HTTPError as e:
        logger.error(f"Failed to fetch JWKS: {e}")
        raise HTTPException(status_code=503, detail="Auth service unavailable")

    # Look up or auto-provision user
    async with db.begin():
        result = await db.execute(select(User).where(User.clerk_id == clerk_id))
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                clerk_id=clerk_id,
                username=clerk_id,
                virtual_balance=Decimal("100000.00"),
            )
            db.add(user)
            await db.flush()
            logger.info(f"Auto-provisioned new user clerk_id={clerk_id} with ₹1,00,000 balance")

    return user.id
