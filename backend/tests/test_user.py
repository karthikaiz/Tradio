import pytest
import logging
from decimal import Decimal
from app.models import User

logger = logging.getLogger(__name__)


@pytest.fixture
async def seeded_user(db_session):
    user = User(id=1, username="abc12345-def6-7890-abcd-ef1234567890", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.commit()
    return user


@pytest.fixture
async def named_user(db_session):
    user = User(id=1, username="hawk_trader", virtual_balance=Decimal("100000.00"))
    db_session.add(user)
    await db_session.commit()
    return user


# ── PROFILE ────────────────────────────────────────────────────────────────────

async def test_get_profile_returns_username(client, db_session, seeded_user):
    response = await client.get("/api/user/profile")
    assert response.status_code == 200
    assert "username" in response.json()
    logger.info("Verified: GET /api/user/profile returns username field")


# ── UPDATE USERNAME ────────────────────────────────────────────────────────────

async def test_update_username_succeeds(client, db_session, seeded_user):
    response = await client.patch("/api/user/username", json={"username": "hawk_trader"})
    assert response.status_code == 200
    assert response.json()["username"] == "hawk_trader"
    logger.info("Verified: valid username update returns 200 with new username")


async def test_update_username_too_short_returns_400(client, db_session, seeded_user):
    response = await client.patch("/api/user/username", json={"username": "ab"})
    assert response.status_code == 400
    logger.info("Verified: username shorter than 3 chars returns 400")


async def test_update_username_too_long_returns_400(client, db_session, seeded_user):
    response = await client.patch("/api/user/username", json={"username": "a" * 21})
    assert response.status_code == 400
    logger.info("Verified: username longer than 20 chars returns 400")


async def test_update_username_invalid_chars_returns_400(client, db_session, seeded_user):
    response = await client.patch("/api/user/username", json={"username": "bad name!"})
    assert response.status_code == 400
    logger.info("Verified: username with spaces/special chars returns 400")


async def test_update_username_duplicate_returns_409(client, db_session, seeded_user):
    other = User(id=2, username="taken_name", virtual_balance=Decimal("100000.00"))
    db_session.add(other)
    await db_session.commit()

    response = await client.patch("/api/user/username", json={"username": "taken_name"})
    assert response.status_code == 409
    logger.info("Verified: duplicate username returns 409 Conflict")


async def test_update_username_allows_underscores_and_numbers(client, db_session, seeded_user):
    response = await client.patch("/api/user/username", json={"username": "trader_99"})
    assert response.status_code == 200
    assert response.json()["username"] == "trader_99"
    logger.info("Verified: underscores and numbers are valid in username")
