"""
Non-destructive migration: adds new tables and backfills data.
Safe to run against an existing NeonDB — does NOT drop any tables.

Run:
    python migrate.py
"""
import asyncio
import os
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.models import Base, User, Watchlist  # noqa — registers all models on Base

DEFAULT_TICKERS: list[str] = []  # no defaults — users build their own watchlist


async def migrate():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set.")

    engine = create_async_engine(database_url, echo=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    print("Ensuring tradio schema exists...")
    async with engine.begin() as conn:
        await conn.execute(sa.text("CREATE SCHEMA IF NOT EXISTS tradio"))

    print("Creating any missing tables (existing tables untouched)...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)
    print("Schema up to date.")

    # Backfill default watchlist for users who have none
    async with session_factory() as session:
        async with session.begin():
            result = await session.execute(sa.select(User))
            users = result.scalars().all()
            seeded = 0
            for user in users:
                wl_result = await session.execute(
                    sa.select(Watchlist).where(Watchlist.user_id == user.id).limit(1)
                )
                if wl_result.scalar_one_or_none() is None:
                    for ticker in DEFAULT_TICKERS:
                        session.add(Watchlist(user_id=user.id, ticker_symbol=ticker))
                    seeded += 1
            print(f"Seeded default watchlist for {seeded} existing user(s).")

    await engine.dispose()
    print("Migration complete.")


if __name__ == "__main__":
    asyncio.run(migrate())
