import logging
import pytest

logger = logging.getLogger(__name__)


@pytest.mark.asyncio
async def test_health_check(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    logger.info("Verified: GET /health returns 200 with {\"status\": \"ok\"}")
