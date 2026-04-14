"""
Seed script: drops and recreates all tables, inserts user_id=1.
Run once against your NeonDB instance:
    python seed.py
"""
import asyncio
import os
from decimal import Decimal
from dotenv import load_dotenv

load_dotenv()

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.models import Base, User


async def seed():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set. Check your .env file.")

    engine = create_async_engine(database_url, echo=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    print("Creating tradio schema if not exists...")
    async with engine.begin() as conn:
        await conn.execute(sa.text("CREATE SCHEMA IF NOT EXISTS tradio"))
    print("Schema ready.")

    print("Dropping and recreating all tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    print("Tables created.")

    async with session_factory() as session:
        async with session.begin():
            user = User(
                id=1,
                username="testuser",
                virtual_balance=Decimal("100000.00"),
            )
            session.add(user)
            print("Inserted user_id=1 (testuser) with balance ₹1,00,000.")

    await engine.dispose()
    print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
