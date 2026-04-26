"""
Tests for Story 3: Portfolio Health Score endpoint.
"""
import pytest
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from app.models import User, Portfolio, Order, OrderSide, OrderStatus, TradeReason


@pytest.fixture
async def user(db_session):
    u = User(id=1, username="testuser", virtual_balance=Decimal("100000.00"))
    db_session.add(u)
    await db_session.commit()
    return u


async def _get(client):
    return await client.get("/api/portfolio/health", headers={"Authorization": "Bearer fake"})


# ── Empty portfolio ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_empty_portfolio_score(client, db_session, user):
    r = await _get(client)
    assert r.status_code == 200
    data = r.json()
    assert "score" in data
    assert "label" in data
    assert "breakdown" in data
    bd = data["breakdown"]
    assert set(bd.keys()) == {"diversification", "concentration", "activity", "discipline"}
    # No holdings, no trades → score=0, label=NEW, all breakdown zeros
    assert bd["diversification"] == 0
    assert bd["concentration"] == 0
    assert bd["activity"] == 0
    assert bd["discipline"] == 0
    assert data["score"] == 0
    assert data["label"] == "NEW"


# ── Diversification scoring ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_diversification_one_holding(client, db_session, user):
    db_session.add(Portfolio(user_id=1, ticker_symbol="RELIANCE", total_quantity=10, avg_buy_price=Decimal("1000")))
    await db_session.commit()
    r = await _get(client)
    assert r.json()["breakdown"]["diversification"] == 5


@pytest.mark.asyncio
async def test_diversification_five_holdings(client, db_session, user):
    for i, t in enumerate(["A", "B", "C", "D", "E"]):
        db_session.add(Portfolio(user_id=1, ticker_symbol=t, total_quantity=1, avg_buy_price=Decimal("100")))
    await db_session.commit()
    r = await _get(client)
    assert r.json()["breakdown"]["diversification"] == 25


# ── Concentration scoring ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_concentration_low(client, db_session, user):
    # Two holdings, 50/50 split → max_pct = 50% → score = 15
    db_session.add(Portfolio(user_id=1, ticker_symbol="A", total_quantity=1, avg_buy_price=Decimal("500")))
    db_session.add(Portfolio(user_id=1, ticker_symbol="B", total_quantity=1, avg_buy_price=Decimal("500")))
    await db_session.commit()
    r = await _get(client)
    assert r.json()["breakdown"]["concentration"] == 15


@pytest.mark.asyncio
async def test_concentration_high(client, db_session, user):
    # One holding dominates >50% → score = 5
    db_session.add(Portfolio(user_id=1, ticker_symbol="A", total_quantity=10, avg_buy_price=Decimal("900")))
    db_session.add(Portfolio(user_id=1, ticker_symbol="B", total_quantity=1, avg_buy_price=Decimal("100")))
    await db_session.commit()
    r = await _get(client)
    assert r.json()["breakdown"]["concentration"] == 5


# ── Activity scoring ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_activity_no_recent_trades(client, db_session, user):
    # Order placed 60 days ago — outside 30-day window
    old_ts = datetime.now(timezone.utc) - timedelta(days=60)
    db_session.add(Order(
        user_id=1, ticker_symbol="X", order_side=OrderSide.BUY,
        quantity=1, execution_price=Decimal("100"),
        status=OrderStatus.EXECUTED, timestamp=old_ts,
    ))
    await db_session.commit()
    r = await _get(client)
    assert r.json()["breakdown"]["activity"] == 0


@pytest.mark.asyncio
async def test_activity_moderate(client, db_session, user):
    # 8 trades in last 30 days → 2/week → score = 25
    for i in range(8):
        ts = datetime.now(timezone.utc) - timedelta(days=i)
        db_session.add(Order(
            user_id=1, ticker_symbol="X", order_side=OrderSide.BUY,
            quantity=1, execution_price=Decimal("100"),
            status=OrderStatus.EXECUTED, timestamp=ts,
        ))
    await db_session.commit()
    r = await _get(client)
    assert r.json()["breakdown"]["activity"] == 25


# ── Discipline scoring ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_discipline_all_with_reason(client, db_session, user):
    for i in range(5):
        db_session.add(Order(
            user_id=1, ticker_symbol="X", order_side=OrderSide.BUY,
            quantity=1, execution_price=Decimal("100"),
            status=OrderStatus.EXECUTED,
            timestamp=datetime.now(timezone.utc),
            trade_reason=TradeReason.MOMENTUM,
        ))
    await db_session.commit()
    r = await _get(client)
    assert r.json()["breakdown"]["discipline"] == 25


@pytest.mark.asyncio
async def test_discipline_none_with_reason(client, db_session, user):
    for i in range(5):
        db_session.add(Order(
            user_id=1, ticker_symbol="X", order_side=OrderSide.BUY,
            quantity=1, execution_price=Decimal("100"),
            status=OrderStatus.EXECUTED,
            timestamp=datetime.now(timezone.utc),
            trade_reason=None,
        ))
    await db_session.commit()
    r = await _get(client)
    assert r.json()["breakdown"]["discipline"] == 3


# ── Label thresholds ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_label_new_user(client, db_session, user):
    # No holdings, no trades → label=NEW
    r = await _get(client)
    assert r.json()["label"] == "NEW"


@pytest.mark.asyncio
async def test_label_disciplined(client, db_session, user):
    # 5 diverse holdings + low concentration + 5 recent trades with reason
    for t in ["A", "B", "C", "D", "E"]:
        db_session.add(Portfolio(user_id=1, ticker_symbol=t, total_quantity=1, avg_buy_price=Decimal("200")))
    for i in range(5):
        db_session.add(Order(
            user_id=1, ticker_symbol="A", order_side=OrderSide.BUY,
            quantity=1, execution_price=Decimal("200"),
            status=OrderStatus.EXECUTED,
            timestamp=datetime.now(timezone.utc) - timedelta(days=i),
            trade_reason=TradeReason.LONG_TERM,
        ))
    await db_session.commit()
    r = await _get(client)
    data = r.json()
    assert data["score"] >= 85
    assert data["label"] == "DISCIPLINED"
