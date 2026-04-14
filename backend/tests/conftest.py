import pytest
import logging
from httpx import AsyncClient, ASGITransport
from app.main import app

logger = logging.getLogger(__name__)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
