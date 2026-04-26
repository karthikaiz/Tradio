"""
Tests for Story 1: Trade Journal (trade_reason field on orders).
"""
import logging
import pytest
from decimal import Decimal
from unittest.mock import patch, AsyncMock
from sqlalchemy import select
from app.models import User, Portfolio, Order, TradeReason
from app.services.market import clear_cache

logger = logging.getLogger(__name__)


@pytest.fixture(autouse=True)
def reset_market_cache():
    clear_cache()
    yield
    clear_cache()


@pytest.fixture
async def seeded_user(db_session):
    user = User(id=1, username="testuser", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.commit()
    return user


def mock_price(price: float):
    return patch("app.services.trade.get_price", new_callable=AsyncMock, return_value=price)


# ── Buy with reason ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_buy_with_reason_stored(client, db_session, seeded_user):
    with mock_price(100.0):
        r = await client.post("/api/trade/buy", json={
            "ticker": "WIPRO",
            "quantity": 5,
            "trade_reason": "MOMENTUM",
        })
    assert r.status_code == 200
    order = (await db_session.execute(select(Order))).scalar_one()
    assert order.trade_reason == TradeReason.MOMENTUM
    logger.info("Verified: BUY with MOMENTUM reason stored on order row")


@pytest.mark.asyncio
async def test_buy_without_reason_is_null(client, db_session, seeded_user):
    with mock_price(100.0):
        r = await client.post("/api/trade/buy", json={"ticker": "WIPRO", "quantity": 1})
    assert r.status_code == 200
    order = (await db_session.execute(select(Order))).scalar_one()
    assert order.trade_reason is None
    logger.info("Verified: BUY without reason stores NULL trade_reason")


@pytest.mark.asyncio
async def test_buy_with_null_reason_is_null(client, db_session, seeded_user):
    with mock_price(100.0):
        r = await client.post("/api/trade/buy", json={
            "ticker": "WIPRO",
            "quantity": 1,
            "trade_reason": None,
        })
    assert r.status_code == 200
    order = (await db_session.execute(select(Order))).scalar_one()
    assert order.trade_reason is None
    logger.info("Verified: BUY with explicit null reason stores NULL trade_reason")


# ── Sell with reason ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sell_with_reason_stored(client, db_session, seeded_user):
    with mock_price(100.0):
        await client.post("/api/trade/buy", json={"ticker": "WIPRO", "quantity": 10})
    with mock_price(120.0):
        r = await client.post("/api/trade/sell", json={
            "ticker": "WIPRO",
            "quantity": 5,
            "trade_reason": "NEWS",
        })
    assert r.status_code == 200
    orders = (await db_session.execute(select(Order).order_by(Order.id))).scalars().all()
    sell_order = orders[1]
    assert sell_order.trade_reason == TradeReason.NEWS
    logger.info("Verified: SELL with NEWS reason stored on order row")


# ── All valid reason values accepted ────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("reason", [
    "MOMENTUM", "NEWS", "LONG_TERM", "FRIEND_TIP",
    "GUT_FEELING", "CHART_PATTERN", "SECTOR_TREND",
])
async def test_all_reason_values_accepted(client, db_session, seeded_user, reason):
    # Re-seed balance for each parametrized run (fixture is function-scoped)
    with mock_price(10.0):
        r = await client.post("/api/trade/buy", json={
            "ticker": "INFY",
            "quantity": 1,
            "trade_reason": reason,
        })
    assert r.status_code == 200, f"Reason {reason} was rejected: {r.text}"
    logger.info(f"Verified: trade_reason={reason} accepted by /api/trade/buy")


@pytest.mark.asyncio
async def test_invalid_reason_rejected(client, seeded_user):
    with mock_price(100.0):
        r = await client.post("/api/trade/buy", json={
            "ticker": "WIPRO",
            "quantity": 1,
            "trade_reason": "RANDOM_GUESS",
        })
    assert r.status_code == 422
    logger.info("Verified: invalid trade_reason value returns 422")


# ── Orders endpoint returns trade_reason ────────────────────────────────────

@pytest.mark.asyncio
async def test_orders_endpoint_returns_trade_reason(client, seeded_user):
    with mock_price(100.0):
        await client.post("/api/trade/buy", json={
            "ticker": "WIPRO",
            "quantity": 1,
            "trade_reason": "CHART_PATTERN",
        })
    r = await client.get("/api/orders")
    assert r.status_code == 200
    orders = r.json()
    assert len(orders) == 1
    assert orders[0]["trade_reason"] == "CHART_PATTERN"
    logger.info("Verified: GET /api/orders includes trade_reason field")


@pytest.mark.asyncio
async def test_orders_endpoint_null_reason(client, seeded_user):
    with mock_price(100.0):
        await client.post("/api/trade/buy", json={"ticker": "WIPRO", "quantity": 1})
    r = await client.get("/api/orders")
    assert r.status_code == 200
    assert r.json()[0]["trade_reason"] is None
    logger.info("Verified: GET /api/orders returns null for missing trade_reason")
