import pytest
import logging
from decimal import Decimal
from unittest.mock import patch, AsyncMock
from app.models import User, Portfolio
from app.services.market import clear_cache

logger = logging.getLogger(__name__)


@pytest.fixture(autouse=True)
def reset_market_cache():
    clear_cache()
    yield
    clear_cache()


def mock_leaderboard_prices(prices: dict[str, float]):
    async def _get_price(ticker):
        if ticker not in prices:
            from app.services.market import MarketDataError
            raise MarketDataError(ticker, "No data")
        return prices[ticker]
    return patch("app.routers.leaderboard.get_price", side_effect=_get_price)


# ── FIXTURES ─────────────────────────────────────────────────────────────────

@pytest.fixture
async def three_users(db_session):
    users = [
        User(id=1, username="alpha", virtual_balance=Decimal("90000.00")),
        User(id=2, username="beta",  virtual_balance=Decimal("100000.00")),
        User(id=3, username="gamma", virtual_balance=Decimal("80000.00")),
    ]
    for u in users:
        db_session.add(u)
    await db_session.commit()
    return users


# ── TESTS ─────────────────────────────────────────────────────────────────────

async def test_leaderboard_empty(client):
    response = await client.get("/api/leaderboard")
    assert response.status_code == 200
    data = response.json()
    assert data["entries"] == []
    assert data["total_users"] == 0
    logger.info("Verified: empty leaderboard returns empty entries and total_users=0")


async def test_leaderboard_rank_by_return_pct(client, db_session, three_users):
    # alpha:  balance=90000, no holdings → total=90000, pnl=-10000, pnl_pct=-10%
    # beta:   balance=100000, no holdings → total=100000, pnl=0, pnl_pct=0%
    # gamma:  balance=80000, no holdings → total=80000, pnl=-20000, pnl_pct=-20%
    # Expected order: beta(0%), alpha(-10%), gamma(-20%)
    response = await client.get("/api/leaderboard")
    assert response.status_code == 200
    data = response.json()
    entries = data["entries"]

    assert len(entries) == 3
    assert entries[0]["username"] == "beta"
    assert entries[1]["username"] == "alpha"
    assert entries[2]["username"] == "gamma"
    assert entries[0]["rank"] == 1
    assert entries[1]["rank"] == 2
    assert entries[2]["rank"] == 3
    logger.info("Verified: users ranked correctly by return %")


async def test_leaderboard_includes_holdings_value(client, db_session, three_users):
    # Give alpha a holding worth 20000 at current price → total = 90000 + 20000 = 110000, pnl=+10%
    holding = Portfolio(
        user_id=1,
        ticker_symbol="RELIANCE",
        total_quantity=10,
        avg_buy_price=Decimal("1000.00"),
    )
    db_session.add(holding)
    await db_session.commit()

    with mock_leaderboard_prices({"RELIANCE": 2000.00}):
        response = await client.get("/api/leaderboard")

    data = response.json()
    entries = {e["username"]: e for e in data["entries"]}

    assert entries["alpha"]["total_value"] == 110000.00
    assert entries["alpha"]["total_pnl"] == 10000.00
    assert entries["alpha"]["total_pnl_pct"] == 10.0
    assert entries["alpha"]["rank"] == 1
    logger.info("Verified: holdings value is included in leaderboard total_value")


async def test_leaderboard_price_failure_falls_back_to_cost_basis(client, db_session, three_users):
    holding = Portfolio(
        user_id=1,
        ticker_symbol="WIPRO",
        total_quantity=5,
        avg_buy_price=Decimal("400.00"),
    )
    db_session.add(holding)
    await db_session.commit()

    # Price fetch fails — should fall back to avg_buy_price (5 * 400 = 2000)
    with mock_leaderboard_prices({}):
        response = await client.get("/api/leaderboard")

    data = response.json()
    entries = {e["username"]: e for e in data["entries"]}
    # alpha: 90000 + (5 * 400 fallback) = 92000, pnl = -8000, pnl_pct = -8%
    assert entries["alpha"]["total_value"] == 92000.00
    logger.info("Verified: price fetch failure falls back to avg_buy_price for cost basis")


async def test_leaderboard_pnl_pct_calculation(client, db_session):
    user = User(id=10, username="trader", virtual_balance=Decimal("150000.00"))
    db_session.add(user)
    await db_session.commit()

    response = await client.get("/api/leaderboard")
    data = response.json()
    entry = data["entries"][0]

    assert entry["total_value"] == 150000.00
    assert entry["total_pnl"] == 50000.00
    assert entry["total_pnl_pct"] == 50.0
    logger.info("Verified: P&L % correctly calculated as (total_pnl / 100000) * 100")


async def test_leaderboard_limit_param(client, db_session):
    for i in range(5):
        db_session.add(User(id=i + 20, username=f"user{i}", virtual_balance=Decimal("100000.00")))
    await db_session.commit()

    response = await client.get("/api/leaderboard?limit=3")
    data = response.json()

    assert len(data["entries"]) == 3
    assert data["total_users"] == 5
    logger.info("Verified: limit parameter caps entries returned while total_users reflects full count")


async def test_leaderboard_new_user_zero_pnl(client, db_session):
    user = User(id=50, username="newbie", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.commit()

    response = await client.get("/api/leaderboard")
    data = response.json()
    entry = data["entries"][0]

    assert entry["total_pnl"] == 0.0
    assert entry["total_pnl_pct"] == 0.0
    assert entry["total_value"] == 100000.00
    logger.info("Verified: new user with no trades shows exactly 0% return")
