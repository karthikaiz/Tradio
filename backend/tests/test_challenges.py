import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, AsyncMock
from app.models import User, Challenge, ChallengeParticipant

FUTURE_START = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
FUTURE_END = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
PAST_END = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
ACTIVE_START = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()


async def _seed_user(db_session):
    user = User(id=1, username="trader1", virtual_balance=100_000.00)
    db_session.add(user)
    await db_session.commit()


async def _seed_challenge(db_session, start=None, end=None) -> int:
    c = Challenge(
        name="Test Battle",
        creator_id=1,
        starting_balance=50_000.00,
        start_date=datetime.now(timezone.utc) - timedelta(hours=1) if start is None else start,
        end_date=datetime.now(timezone.utc) + timedelta(days=7) if end is None else end,
    )
    db_session.add(c)
    await db_session.commit()
    return c.id


# ── Create challenge ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_challenge(client, db_session):
    await _seed_user(db_session)
    resp = await client.post("/api/challenges", json={
        "name": "Weekly Battle",
        "starting_balance": 50000,
        "start_date": ACTIVE_START,
        "end_date": FUTURE_END,
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Weekly Battle"
    assert data["starting_balance"] == 50000.0
    assert data["status"] in ("active", "upcoming")
    assert data["participant_count"] == 0


@pytest.mark.asyncio
async def test_create_challenge_past_end_date_rejected(client, db_session):
    await _seed_user(db_session)
    resp = await client.post("/api/challenges", json={
        "name": "Bad Battle",
        "starting_balance": 50000,
        "start_date": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
        "end_date": PAST_END,
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_challenge_end_before_start_rejected(client, db_session):
    await _seed_user(db_session)
    resp = await client.post("/api/challenges", json={
        "name": "Backwards",
        "starting_balance": 50000,
        "start_date": FUTURE_END,
        "end_date": FUTURE_START,
    })
    assert resp.status_code == 400


# ── List / Get ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_challenges(client, db_session):
    await _seed_user(db_session)
    await _seed_challenge(db_session)
    resp = await client.get("/api/challenges")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert len(data["challenges"]) == 1


@pytest.mark.asyncio
async def test_get_challenge_not_found(client, db_session):
    await _seed_user(db_session)
    resp = await client.get("/api/challenges/999")
    assert resp.status_code == 404


# ── Join ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_join_challenge(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    resp = await client.post(f"/api/challenges/{cid}/join")
    assert resp.status_code == 201
    data = resp.json()
    assert data["joined"] is True
    assert data["balance"] == 50_000.0


@pytest.mark.asyncio
async def test_join_twice_rejected(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    await client.post(f"/api/challenges/{cid}/join")
    resp = await client.post(f"/api/challenges/{cid}/join")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_join_ended_challenge_rejected(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(
        db_session,
        start=datetime.now(timezone.utc) - timedelta(days=8),
        end=datetime.now(timezone.utc) - timedelta(days=1),
    )
    resp = await client.post(f"/api/challenges/{cid}/join")
    assert resp.status_code == 400


# ── Leaderboard ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_challenge_leaderboard_empty(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    resp = await client.get(f"/api/challenges/{cid}/leaderboard")
    assert resp.status_code == 200
    assert resp.json()["entries"] == []


@pytest.mark.asyncio
async def test_challenge_leaderboard_with_participant(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    await client.post(f"/api/challenges/{cid}/join")
    resp = await client.get(f"/api/challenges/{cid}/leaderboard")
    assert resp.status_code == 200
    entries = resp.json()["entries"]
    assert len(entries) == 1
    assert entries[0]["rank"] == 1
    assert entries[0]["total_pnl_pct"] == 0.0  # no trades yet


# ── Buy / Sell ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_buy_without_joining_rejected(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    with patch("app.services.challenge_trade.get_price", new=AsyncMock(return_value=100.0)):
        resp = await client.post(f"/api/challenges/{cid}/buy", json={"ticker": "RELIANCE", "quantity": 1})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_buy_in_challenge(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    await client.post(f"/api/challenges/{cid}/join")
    with patch("app.services.challenge_trade.get_price", new=AsyncMock(return_value=100.0)):
        resp = await client.post(f"/api/challenges/{cid}/buy", json={"ticker": "RELIANCE", "quantity": 10})
    assert resp.status_code == 200
    data = resp.json()
    assert data["ticker"] == "RELIANCE"
    assert data["total_cost"] == 1000.0
    assert data["new_balance"] == 49_000.0


@pytest.mark.asyncio
async def test_buy_insufficient_balance(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    await client.post(f"/api/challenges/{cid}/join")
    with patch("app.services.challenge_trade.get_price", new=AsyncMock(return_value=100_000.0)):
        resp = await client.post(f"/api/challenges/{cid}/buy", json={"ticker": "RELIANCE", "quantity": 10})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_sell_without_position(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    await client.post(f"/api/challenges/{cid}/join")
    with patch("app.services.challenge_trade.get_price", new=AsyncMock(return_value=100.0)):
        resp = await client.post(f"/api/challenges/{cid}/sell", json={"ticker": "RELIANCE", "quantity": 1})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_buy_then_sell(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    await client.post(f"/api/challenges/{cid}/join")
    with patch("app.services.challenge_trade.get_price", new=AsyncMock(return_value=100.0)):
        await client.post(f"/api/challenges/{cid}/buy", json={"ticker": "RELIANCE", "quantity": 5})
        resp = await client.post(f"/api/challenges/{cid}/sell", json={"ticker": "RELIANCE", "quantity": 5})
    assert resp.status_code == 200
    data = resp.json()
    assert data["proceeds"] == 500.0
    assert data["realized_pnl"] == 0.0  # bought and sold at same price


# ── Portfolio / Orders ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_challenge_portfolio_not_participant(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    resp = await client.get(f"/api/challenges/{cid}/portfolio")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_challenge_portfolio_after_join(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    await client.post(f"/api/challenges/{cid}/join")
    resp = await client.get(f"/api/challenges/{cid}/portfolio")
    assert resp.status_code == 200
    data = resp.json()
    assert data["available_balance"] == 50_000.0
    assert data["holdings"] == []


@pytest.mark.asyncio
async def test_challenge_orders(client, db_session):
    await _seed_user(db_session)
    cid = await _seed_challenge(db_session)
    await client.post(f"/api/challenges/{cid}/join")
    with patch("app.services.challenge_trade.get_price", new=AsyncMock(return_value=200.0)):
        await client.post(f"/api/challenges/{cid}/buy", json={"ticker": "TCS", "quantity": 2})
    resp = await client.get(f"/api/challenges/{cid}/orders")
    assert resp.status_code == 200
    orders = resp.json()
    assert len(orders) == 1
    assert orders[0]["ticker"] == "TCS"
    assert orders[0]["side"] == "BUY"
