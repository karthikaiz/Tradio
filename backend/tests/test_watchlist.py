import pytest
import logging
from decimal import Decimal
from app.models import User, Watchlist

logger = logging.getLogger(__name__)


@pytest.fixture
async def seeded_user(db_session):
    user = User(id=1, username="testuser", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.commit()
    return user


# ── GET ────────────────────────────────────────────────────────────────────────

async def test_get_watchlist_empty(client, db_session, seeded_user):
    response = await client.get("/api/watchlist")
    assert response.status_code == 200
    assert response.json()["tickers"] == []
    logger.info("Verified: empty watchlist returns empty list")


async def test_get_watchlist_returns_tickers_in_order(client, db_session, seeded_user):
    for ticker in ["RELIANCE", "TCS", "INFY"]:
        db_session.add(Watchlist(user_id=1, ticker_symbol=ticker))
    await db_session.commit()

    response = await client.get("/api/watchlist")
    assert response.status_code == 200
    assert response.json()["tickers"] == ["RELIANCE", "TCS", "INFY"]
    logger.info("Verified: watchlist returns tickers in insertion order")


# ── POST ───────────────────────────────────────────────────────────────────────

async def test_add_ticker_succeeds(client, db_session, seeded_user):
    response = await client.post("/api/watchlist", json={"ticker": "RELIANCE"})
    assert response.status_code == 201
    assert response.json()["ticker"] == "RELIANCE"
    logger.info("Verified: adding ticker returns 201 and ticker symbol")


async def test_add_ticker_uppercases(client, db_session, seeded_user):
    response = await client.post("/api/watchlist", json={"ticker": "reliance"})
    assert response.status_code == 201
    assert response.json()["ticker"] == "RELIANCE"
    logger.info("Verified: ticker is stored uppercase regardless of input case")


async def test_add_duplicate_ticker_returns_409(client, db_session, seeded_user):
    await client.post("/api/watchlist", json={"ticker": "TCS"})
    response = await client.post("/api/watchlist", json={"ticker": "TCS"})
    assert response.status_code == 409
    logger.info("Verified: duplicate ticker returns 409 Conflict")


async def test_add_empty_ticker_returns_400(client, db_session, seeded_user):
    response = await client.post("/api/watchlist", json={"ticker": "  "})
    assert response.status_code == 400
    logger.info("Verified: empty ticker returns 400")


# ── DELETE ─────────────────────────────────────────────────────────────────────

async def test_remove_ticker_succeeds(client, db_session, seeded_user):
    db_session.add(Watchlist(user_id=1, ticker_symbol="WIPRO"))
    await db_session.commit()

    response = await client.delete("/api/watchlist/WIPRO")
    assert response.status_code == 204

    check = await client.get("/api/watchlist")
    assert "WIPRO" not in check.json()["tickers"]
    logger.info("Verified: deleting existing ticker returns 204 and removes it")


async def test_remove_nonexistent_ticker_returns_404(client, db_session, seeded_user):
    response = await client.delete("/api/watchlist/FAKECORP")
    assert response.status_code == 404
    logger.info("Verified: deleting non-existent ticker returns 404")
