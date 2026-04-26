"""
Tests for Story 2: AI Coach endpoint.
All tests mock the Groq client — no real API calls.
"""
import logging
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from decimal import Decimal
from app.models import User
from app.routers.coach import _detect_tone, _trim_to_sentences

logger = logging.getLogger(__name__)

VALID_PAYLOAD = {
    "ticker": "WIPRO",
    "side": "BUY",
    "quantity": 5,
    "execution_price": 250.0,
    "trade_reason": "MOMENTUM",
    "portfolio_context": {
        "available_balance": 80000.0,
        "total_invested": 20000.0,
        "total_unrealized_pnl": 500.0,
        "total_unrealized_pnl_pct": 2.5,
        "holdings": [
            {
                "ticker": "RELIANCE",
                "name": "Reliance Industries",
                "quantity": 10,
                "avg_buy_price": 1200.0,
                "current_price": 1250.0,
                "invested_value": 12000.0,
                "unrealized_pnl": 500.0,
                "unrealized_pnl_pct": 4.17,
            }
        ],
    },
}


@pytest.fixture
async def seeded_user(db_session):
    user = User(id=1, username="coachtest", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.commit()
    return user


def make_groq_response(content: str):
    """Build a minimal mock that looks like a Groq chat completion response."""
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp


# ── Unit tests for pure helpers ──────────────────────────────────────────────

def test_detect_tone_warning():
    assert _detect_tone("Be careful, this is a risky trade.") == "warning"
    logger.info("Verified: _detect_tone returns 'warning' for risky language")


def test_detect_tone_positive():
    assert _detect_tone("Good discipline on this one, solid entry.") == "positive"
    logger.info("Verified: _detect_tone returns 'positive' for encouraging language")


def test_detect_tone_info_default():
    assert _detect_tone("You bought at a common support level.") == "info"
    logger.info("Verified: _detect_tone returns 'info' as default")


def test_trim_to_sentences_two():
    text = "First sentence. Second sentence. Third sentence."
    assert _trim_to_sentences(text, 2) == "First sentence. Second sentence."
    logger.info("Verified: _trim_to_sentences caps at 2 sentences")


def test_trim_to_sentences_single():
    text = "Only one sentence here."
    assert _trim_to_sentences(text, 2) == "Only one sentence here."
    logger.info("Verified: _trim_to_sentences handles single-sentence response")


# ── Endpoint: no API key returns fallback ───────────────────────────────────

@pytest.mark.asyncio
async def test_feedback_no_api_key_returns_fallback(client, seeded_user):
    with patch.dict("os.environ", {}, clear=False):
        import os
        os.environ.pop("GROQ_API_KEY", None)
        r = await client.post("/api/coach/feedback", json=VALID_PAYLOAD)
    assert r.status_code == 200
    body = r.json()
    assert "GROQ_API_KEY" in body["feedback"]
    assert body["tone"] == "info"
    logger.info("Verified: missing GROQ_API_KEY returns 200 with fallback message")


# ── Endpoint: valid call returns feedback ───────────────────────────────────

@pytest.mark.asyncio
async def test_feedback_returns_coach_response(client, seeded_user):
    mock_resp = make_groq_response(
        "This was a momentum trade, but volume was weak. Consider waiting for confirmation next time."
    )
    with patch("app.routers.coach.AsyncGroq") as MockGroq:
        instance = AsyncMock()
        instance.chat.completions.create = AsyncMock(return_value=mock_resp)
        MockGroq.return_value = instance

        with patch.dict("os.environ", {"GROQ_API_KEY": "test-key"}):
            r = await client.post("/api/coach/feedback", json=VALID_PAYLOAD)

    assert r.status_code == 200
    body = r.json()
    assert "feedback" in body
    assert body["tone"] in ("positive", "warning", "info")
    assert len(body["feedback"]) > 10
    logger.info(f"Verified: /api/coach/feedback returns feedback with tone='{body['tone']}'")


@pytest.mark.asyncio
async def test_feedback_tone_warning_detected(client, seeded_user):
    mock_resp = make_groq_response("Be careful, this stock is quite risky right now.")
    with patch("app.routers.coach.AsyncGroq") as MockGroq:
        instance = AsyncMock()
        instance.chat.completions.create = AsyncMock(return_value=mock_resp)
        MockGroq.return_value = instance

        with patch.dict("os.environ", {"GROQ_API_KEY": "test-key"}):
            r = await client.post("/api/coach/feedback", json=VALID_PAYLOAD)

    assert r.json()["tone"] == "warning"
    logger.info("Verified: warning tone detected correctly from response content")


@pytest.mark.asyncio
async def test_feedback_tone_positive_detected(client, seeded_user):
    mock_resp = make_groq_response("Good discipline logging a reason. Solid sector choice.")
    with patch("app.routers.coach.AsyncGroq") as MockGroq:
        instance = AsyncMock()
        instance.chat.completions.create = AsyncMock(return_value=mock_resp)
        MockGroq.return_value = instance

        with patch.dict("os.environ", {"GROQ_API_KEY": "test-key"}):
            r = await client.post("/api/coach/feedback", json=VALID_PAYLOAD)

    assert r.json()["tone"] == "positive"
    logger.info("Verified: positive tone detected correctly from response content")


# ── Endpoint: null trade_reason accepted ────────────────────────────────────

@pytest.mark.asyncio
async def test_feedback_null_reason_accepted(client, seeded_user):
    payload = {**VALID_PAYLOAD, "trade_reason": None}
    mock_resp = make_groq_response("No reason logged — try adding one next time.")
    with patch("app.routers.coach.AsyncGroq") as MockGroq:
        instance = AsyncMock()
        instance.chat.completions.create = AsyncMock(return_value=mock_resp)
        MockGroq.return_value = instance

        with patch.dict("os.environ", {"GROQ_API_KEY": "test-key"}):
            r = await client.post("/api/coach/feedback", json=payload)

    assert r.status_code == 200
    logger.info("Verified: null trade_reason accepted by coach endpoint")


# ── Endpoint: Groq API error returns 502 ────────────────────────────────────

@pytest.mark.asyncio
async def test_feedback_groq_error_returns_502(client, seeded_user):
    from groq import APIStatusError
    import httpx

    with patch("app.routers.coach.AsyncGroq") as MockGroq:
        instance = AsyncMock()
        instance.chat.completions.create = AsyncMock(
            side_effect=APIStatusError(
                "rate limited",
                response=httpx.Response(429, request=httpx.Request("POST", "https://api.groq.com")),
                body={"error": "rate limited"},
            )
        )
        MockGroq.return_value = instance

        with patch.dict("os.environ", {"GROQ_API_KEY": "test-key"}):
            r = await client.post("/api/coach/feedback", json=VALID_PAYLOAD)

    assert r.status_code == 502
    logger.info("Verified: Groq API error returns 502 to client")


# ── Auth required ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_feedback_requires_auth(client):
    from app.auth import get_current_user_id
    from app.main import app

    async def deny():
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Unauthorized")

    app.dependency_overrides[get_current_user_id] = deny
    r = await client.post("/api/coach/feedback", json=VALID_PAYLOAD)
    app.dependency_overrides.pop(get_current_user_id, None)
    assert r.status_code == 401
    logger.info("Verified: /api/coach/feedback requires authentication")
