import logging
import pytest
from decimal import Decimal
from unittest.mock import patch, AsyncMock
from sqlalchemy import select
from app.models import User, Portfolio, Order, OrderSide, OrderStatus
from app.services.market import clear_cache

logger = logging.getLogger(__name__)


@pytest.fixture(autouse=True)
def reset_market_cache():
    clear_cache()
    yield
    clear_cache()


@pytest.fixture
async def seeded_user(db_session):
    """Insert user_id=1 with ₹1,00,000 balance."""
    user = User(id=1, username="testuser", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.commit()
    return user


def mock_price(price: float):
    return patch("app.services.trade.get_price", new_callable=AsyncMock, return_value=price)


# ── BUY TESTS ────────────────────────────────────────────────────────────────

async def test_buy_success_new_position(client, db_session, seeded_user):
    with mock_price(2900.00):
        response = await client.post("/api/trade/buy", json={"ticker": "RELIANCE", "quantity": 5})

    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "RELIANCE"
    assert data["quantity"] == 5
    assert data["execution_price"] == 2900.00
    assert data["total_cost"] == 14500.00
    assert data["new_balance"] == 85500.00

    # Expire session cache so we read committed state from DB
    await db_session.close()

    # Verify DB state
    result = await db_session.execute(select(User).where(User.id == 1))
    user = result.scalar_one()
    assert round(float(user.virtual_balance), 2) == 85500.00

    port = await db_session.execute(select(Portfolio).where(Portfolio.ticker_symbol == "RELIANCE"))
    holding = port.scalar_one()
    assert holding.total_quantity == 5
    assert float(holding.avg_buy_price) == 2900.00

    order = await db_session.execute(select(Order).where(Order.ticker_symbol == "RELIANCE"))
    o = order.scalar_one()
    assert o.order_side == OrderSide.BUY
    assert o.realized_pnl is None
    assert o.status == OrderStatus.EXECUTED

    logger.info("Verified: BUY creates portfolio row, debits balance, records order correctly")


async def test_buy_updates_avg_price(client, db_session, seeded_user):
    # First buy: 10 @ 100
    with mock_price(100.00):
        r1 = await client.post("/api/trade/buy", json={"ticker": "WIPRO", "quantity": 10})
    assert r1.status_code == 200

    # Second buy: 10 @ 200
    with mock_price(200.00):
        r2 = await client.post("/api/trade/buy", json={"ticker": "WIPRO", "quantity": 10})
    assert r2.status_code == 200

    port = await db_session.execute(select(Portfolio).where(Portfolio.ticker_symbol == "WIPRO"))
    holding = port.scalar_one()

    assert holding.total_quantity == 20
    assert float(holding.avg_buy_price) == 150.00  # (10*100 + 10*200) / 20 = 150

    logger.info("Verified: buy 10@100 then 10@200 → avg_buy_price == 150.00 (weighted average)")


async def test_buy_insufficient_balance(client, db_session, seeded_user):
    # Price * quantity >> 100000 balance
    with mock_price(99999.00):
        response = await client.post("/api/trade/buy", json={"ticker": "RELIANCE", "quantity": 10})

    assert response.status_code == 400
    data = response.json()
    assert data["detail"]["error"] == "Insufficient balance"
    assert "required" in data["detail"]
    assert "available" in data["detail"]

    # Balance must be unchanged
    result = await db_session.execute(select(User).where(User.id == 1))
    user = result.scalar_one()
    assert float(user.virtual_balance) == 100000.00

    # No portfolio row created
    port = await db_session.execute(select(Portfolio).where(Portfolio.ticker_symbol == "RELIANCE"))
    assert port.scalar_one_or_none() is None

    # No order recorded
    orders = await db_session.execute(select(Order))
    assert orders.scalars().all() == []

    logger.info("Verified: insufficient balance returns 400, no DB state changed")


async def test_buy_market_data_error(client, db_session, seeded_user):
    from app.services.market import MarketDataError
    with patch(
        "app.services.trade.get_price",
        new_callable=AsyncMock,
        side_effect=MarketDataError("RELIANCE", "Connection timeout"),
    ):
        response = await client.post("/api/trade/buy", json={"ticker": "RELIANCE", "quantity": 5})

    assert response.status_code == 503
    assert response.json()["detail"]["error"] == "Market data unavailable"

    # No DB changes
    result = await db_session.execute(select(User).where(User.id == 1))
    user = result.scalar_one()
    assert float(user.virtual_balance) == 100000.00

    orders = await db_session.execute(select(Order))
    assert orders.scalars().all() == []

    logger.info("Verified: MarketDataError returns 503 with no DB state changes")


async def test_buy_invalid_quantity(client, db_session, seeded_user):
    with mock_price(2900.00):
        r1 = await client.post("/api/trade/buy", json={"ticker": "RELIANCE", "quantity": 0})
        r2 = await client.post("/api/trade/buy", json={"ticker": "RELIANCE", "quantity": -5})

    assert r1.status_code == 422  # Pydantic validation error
    assert r2.status_code == 422

    logger.info("Verified: quantity=0 and negative quantity rejected with 422 before hitting DB")


# ── SELL TESTS ───────────────────────────────────────────────────────────────

@pytest.fixture
async def held_position(client, db_session, seeded_user):
    """Buy 10 WIPRO @ 200 to create a holding for sell tests."""
    with mock_price(200.00):
        r = await client.post("/api/trade/buy", json={"ticker": "WIPRO", "quantity": 10})
    assert r.status_code == 200
    await db_session.close()
    return r.json()


async def test_sell_success_partial(client, db_session, held_position):
    with mock_price(250.00):
        response = await client.post("/api/trade/sell", json={"ticker": "WIPRO", "quantity": 3})

    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "WIPRO"
    assert data["quantity"] == 3
    assert data["execution_price"] == 250.00
    assert data["proceeds"] == 750.00
    assert data["realized_pnl"] == 150.00  # (250 - 200) * 3

    await db_session.close()
    port = await db_session.execute(select(Portfolio).where(Portfolio.ticker_symbol == "WIPRO"))
    holding = port.scalar_one()
    assert holding.total_quantity == 7

    logger.info("Verified: partial sell debits quantity, credits balance, records realized P&L")


async def test_sell_profit(client, db_session, held_position):
    """Buy @ 200, sell @ 300 → realized_pnl = (300-200)*5 = 500."""
    with mock_price(300.00):
        response = await client.post("/api/trade/sell", json={"ticker": "WIPRO", "quantity": 5})

    assert response.status_code == 200
    assert response.json()["realized_pnl"] == 500.00

    logger.info("Verified: sell above avg_buy_price produces positive realized_pnl")


async def test_sell_loss(client, db_session, held_position):
    """Buy @ 200, sell @ 150 → realized_pnl = (150-200)*5 = -250."""
    with mock_price(150.00):
        response = await client.post("/api/trade/sell", json={"ticker": "WIPRO", "quantity": 5})

    assert response.status_code == 200
    assert response.json()["realized_pnl"] == -250.00

    logger.info("Verified: sell below avg_buy_price produces negative realized_pnl (loss)")


async def test_sell_full_position_removes_row(client, db_session, held_position):
    """Selling all 10 units must delete the Portfolio row."""
    with mock_price(250.00):
        response = await client.post("/api/trade/sell", json={"ticker": "WIPRO", "quantity": 10})

    assert response.status_code == 200

    await db_session.close()
    port = await db_session.execute(select(Portfolio).where(Portfolio.ticker_symbol == "WIPRO"))
    assert port.scalar_one_or_none() is None

    logger.info("Verified: selling full position deletes the Portfolio row")


async def test_sell_no_position(client, db_session, seeded_user):
    response = await client.post("/api/trade/sell", json={"ticker": "TCS", "quantity": 5})

    assert response.status_code == 400
    assert response.json()["detail"]["error"] == "No position found"
    assert response.json()["detail"]["ticker"] == "TCS"

    logger.info("Verified: selling ticker not held returns 400 with 'No position found'")


async def test_sell_insufficient_holdings(client, db_session, held_position):
    """Hold 10, try to sell 99 → 400."""
    with mock_price(250.00):
        response = await client.post("/api/trade/sell", json={"ticker": "WIPRO", "quantity": 99})

    assert response.status_code == 400
    data = response.json()["detail"]
    assert data["error"] == "Insufficient holdings"
    assert data["requested"] == 99
    assert data["available"] == 10

    logger.info("Verified: selling more than held returns 400 with requested/available quantities")


async def test_sell_market_data_error(client, db_session, held_position):
    from app.services.market import MarketDataError
    with patch(
        "app.services.trade.get_price",
        new_callable=AsyncMock,
        side_effect=MarketDataError("WIPRO", "Timeout"),
    ):
        response = await client.post("/api/trade/sell", json={"ticker": "WIPRO", "quantity": 5})

    assert response.status_code == 503

    # Holdings must be unchanged
    await db_session.close()
    port = await db_session.execute(select(Portfolio).where(Portfolio.ticker_symbol == "WIPRO"))
    holding = port.scalar_one()
    assert holding.total_quantity == 10

    logger.info("Verified: market data error on sell returns 503, holdings unchanged")
