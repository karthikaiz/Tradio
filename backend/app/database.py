import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool
from dotenv import load_dotenv

load_dotenv()


class Base(DeclarativeBase):
    pass


# Process-wide singletons. The old code built a NEW engine (with its own
# connection pool) on EVERY request and never disposed it — invisible on
# Vercel serverless (process dies after each invocation), but on a
# long-running Fly machine each request leaked an engine + connection until
# Supabase ran out of connection slots and every DB endpoint returned 500.
_engine = None
_session_factory = None


def get_engine():
    global _engine
    if _engine is None:
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL is not set. Check your .env file.")
        # Accept plain postgres URLs as copied from Supabase/Neon dashboards —
        # SQLAlchemy async needs the +asyncpg driver marker.
        if database_url.startswith("postgresql://"):
            database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif database_url.startswith("postgres://"):
            database_url = database_url.replace("postgres://", "postgresql+asyncpg://", 1)
        # NullPool: one fresh connection per session, closed at the end —
        # exactly the connection behaviour that worked on Vercel (so it stays
        # compatible with Supabase's pgbouncer transaction pooler), minus the
        # engine leak. No idle connections held between requests.
        _engine = create_async_engine(database_url, echo=False, poolclass=NullPool)
    return _engine


def get_session_factory(engine=None):
    global _session_factory
    if engine is not None:
        # Explicit engine (tests) — build a dedicated factory, don't cache
        return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(), expire_on_commit=False, class_=AsyncSession
        )
    return _session_factory


async def get_db():
    factory = get_session_factory()
    async with factory() as session:
        yield session
