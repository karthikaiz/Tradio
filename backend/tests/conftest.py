import pytest
import logging
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.main import app
from app.database import Base, get_db
from app.auth import get_current_user_id
from app import models  # noqa: F401 — ensure models are registered on Base

logger = logging.getLogger(__name__)

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "real_market_hours: don't pin the clock open — for tests that "
        "exercise the market-closed guard itself",
    )


@pytest.fixture(autouse=True)
def market_open(request):
    """Pin the trade endpoints' market-hours guard open.

    /api/trade/buy|sell call _assert_market_open(), which consults the real
    wall clock. Without this the entire trade, trade-journal and portfolio
    suites (26 tests) pass only when CI happens to run between 09:15 and
    15:30 IST on a non-holiday weekday, and 400 otherwise — a green suite in
    the morning and a red one in the evening, for reasons unrelated to the code.

    Tests marked @pytest.mark.real_market_hours opt out and drive
    get_market_status directly with an explicit `now`.
    """
    if "real_market_hours" in request.keywords:
        yield
        return
    with patch(
        "app.routers.trade.get_market_status",
        return_value={"open": True, "reason": "", "next_open": None},
    ):
        yield


SCHEMA_TRANSLATE = {"schema_translate_map": {"tradio": None}}


@pytest.fixture
async def db_engine():
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        execution_options=SCHEMA_TRANSLATE,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    async def override_get_current_user_id():
        return 1

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_id] = override_get_current_user_id
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
