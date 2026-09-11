import logging
import pytest

logger = logging.getLogger(__name__)


@pytest.mark.asyncio
async def test_health_check(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    logger.info("Verified: GET /health returns 200 with status ok")


@pytest.mark.asyncio
async def test_health_reports_memory(client):
    """This machine has a 256MB cap with swap behind it. Once RSS passes the
    cap the kernel swaps, and swap here is slow enough that ordinary requests
    exceed the caller's timeout — which reaches the bot as 'price feed stale'
    on every ticker with no hint that memory caused it. /health carries the
    reading so the next incident is measurable."""
    response = await client.get("/health")
    mem = response.json()["memory"]

    assert mem["rss_mb"] > 0
    assert mem["limit_mb"] == 256
    assert 0 < mem["pct_of_limit"] <= 200
    assert isinstance(mem["swapping"], bool)
    logger.info(
        "Verified: /health reports %.1f MB (%.1f%% of limit, swapping=%s)",
        mem["rss_mb"], mem["pct_of_limit"], mem["swapping"],
    )
