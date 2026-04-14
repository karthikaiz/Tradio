import logging
import pytest
from decimal import Decimal
from unittest.mock import patch, AsyncMock
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
    user = User(id=1, username="testuser", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.commit()
    return user


def mock_price(price: float):
    return patch("app.services.trade.get_price", new_callable=AsyncMock, return_value=price)


def mock_portfolio_prices(prices: dict[str, float]):
    """Patch get_price in portfolio router with per-ticker prices."""
    async def _get_price(ticker):
        if ticker not in prices:
            from app.services.market import MarketDataError
            raise MarketDataError(ticker, "No data")
        return prices[ticker]
    return patch("app.routers.portfolio.get_price", side_effect=_get_price)


# ── PORTFOLIO TESTS ───────────────────────────────────────────────────────────

async def test_portfolio_empty(client, db_session, seeded_user):
    response = await client.get("/api/portfolio")
    assert response.status_code == 200
    data = response.json()

    assert data["available_balance"] == 100000.00
    assert data["holdings"] == []
    assert data["total_invested"] == 0.0
    assert data["total_unrealized_pnl"] == 0.0
    assert data["total_realized_pnl"] == 0.0

    logger.info("Verified: empty portfolio returns zero totals and empty holdings list")


async def test_portfolio_single_holding(client, db_session, seeded_user):
    # Buy 10 RELIANCE @ 2900
    with mock_price(2900.00):
        await client.post("/api/trade/buy", json={"ticker": "RELIANCE", "quantity": 10})

    # Portfolio fetch with current price = 3000
    with mock_portfolio_prices({"RELIANCE": 3000.00}):
        response = await client.get("/api/portfolio")

    assert response.status_code == 200
    data = response.json()
    holding = data["holdings"][0]

    assert holding["ticker"] == "RELIANCE"
    assert holding["quantity"] == 10
    assert holding["avg_buy_price"] == 2900.00
    assert holding["current_price"] == 3000.00
    assert holding["invested_value"] == 29000.00
    assert holding["current_value"] == 30000.00
    assert holding["unrealized_pnl"] == 1000.00
    assert holding["unrealized_pnl_pct"] == round((1000 / 29000) * 100, 2)

    logger.info("Verified: single holding P&L math is correct")


async def test_portfolio_multiple_holdings(client, db_session, seeded_user):
    with mock_price(1000.00):
        await client.post("/api/trade/buy", json={"ticker": "INFY", "quantity": 5})
    with mock_price(2000.00):
        await client.post("/api/trade/buy", json={"ticker": "TCS", "quantity": 3})

    prices = {"INFY": 1100.00, "TCS": 1900.00}
    with mock_portfolio_prices(prices):
        response = await client.get("/api/portfolio")

    data = response.json()
    assert len(data["holdings"]) == 2

    # INFY: invested=5000, current=5500, pnl=+500
    # TCS:  invested=6000, current=5700, pnl=-300
    assert data["total_invested"] == 11000.00
    assert data["total_current_value"] == 11200.00
    assert data["total_unrealized_pnl"] == 200.00

    logger.info("Verified: multiple holdings aggregate totals correctly")


async def test_portfolio_one_price_fails(client, db_session, seeded_user):
    with mock_price(1000.00):
        await client.post("/api/trade/buy", json={"ticker": "INFY", "quantity": 5})
    with mock_price(2000.00):
        await client.post("/api/trade/buy", json={"ticker": "TCS", "quantity": 3})

    # INFY price fails, TCS succeeds
    with mock_portfolio_prices({"TCS": 2100.00}):
        response = await client.get("/api/portfolio")

    assert response.status_code == 200
    data = response.json()
    tickers = {h["ticker"]: h for h in data["holdings"]}

    assert tickers["INFY"]["current_price"] is None
    assert tickers["INFY"]["error"] is not None
    assert tickers["TCS"]["current_price"] == 2100.00
    assert tickers["TCS"]["error"] is None

    logger.info("Verified: failed price for one holding returns error field, others unaffected")


async def test_portfolio_realized_pnl_accumulates(client, db_session, seeded_user):
    # Buy 10 @ 100, sell 5 @ 150 (pnl=+250), sell 5 @ 80 (pnl=-100)
    with mock_price(100.00):
        await client.post("/api/trade/buy", json={"ticker": "WIPRO", "quantity": 10})
    with mock_price(150.00):
        await client.post("/api/trade/sell", json={"ticker": "WIPRO", "quantity": 5})
    with mock_price(80.00):
        await client.post("/api/trade/sell", json={"ticker": "WIPRO", "quantity": 5})

    with mock_portfolio_prices({}):
        response = await client.get("/api/portfolio")

    data = response.json()
    assert data["total_realized_pnl"] == 150.00  # 250 + (-100)
    assert data["holdings"] == []  # all sold

    logger.info("Verified: total_realized_pnl sums across multiple SELL orders correctly")


# ── ORDER HISTORY TESTS ───────────────────────────────────────────────────────

async def test_order_history_newest_first(client, db_session, seeded_user):
    with mock_price(100.00):
        await client.post("/api/trade/buy", json={"ticker": "WIPRO", "quantity": 5})
    with mock_price(120.00):
        await client.post("/api/trade/sell", json={"ticker": "WIPRO", "quantity": 5})

    response = await client.get("/api/orders")
    assert response.status_code == 200
    orders = response.json()

    assert len(orders) == 2
    assert orders[0]["side"] == "SELL"   # newest first
    assert orders[1]["side"] == "BUY"
    assert orders[0]["realized_pnl"] == 100.00  # (120-100)*5
    assert orders[1]["realized_pnl"] is None    # BUY has no realized_pnl

    logger.info("Verified: orders returned newest-first, SELL has realized_pnl, BUY has null")


async def test_order_history_pagination(client, db_session, seeded_user):
    # Create 6 orders (3 buy+sell pairs)
    for price in [100, 200, 300]:
        with mock_price(float(price)):
            await client.post("/api/trade/buy", json={"ticker": "WIPRO", "quantity": 1})
            await client.post("/api/trade/sell", json={"ticker": "WIPRO", "quantity": 1})

    r1 = await client.get("/api/orders?limit=4&offset=0")
    r2 = await client.get("/api/orders?limit=4&offset=4")

    assert len(r1.json()) == 4
    assert len(r2.json()) == 2

    logger.info("Verified: order history pagination — limit=4 offset=0 → 4 results, offset=4 → 2 results")
