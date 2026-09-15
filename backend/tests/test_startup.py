"""Startup must never block on a third party.

A FastAPI startup handler runs before uvicorn binds the port, so anything
awaited there delays the process becoming reachable. The handler used to
await an Angel One login that had no timeout and, by its own docstring, took
~16s. Fly began health-checking at grace_period with a 5s timeout, the checks
failed while the app was still starting, Fly killed the machine, and the next
boot did the same — a restart loop in which the app never finished starting.

From outside that looked like every price request timing out at once with
/health unreachable too, which is the recurring "price feed stale" outage.
It is also why fixes inside the app never helped: they were in a process that
was not running.
"""

import asyncio
import logging
import tomllib
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

logger = logging.getLogger(__name__)


async def test_startup_returns_without_awaiting_the_angel_login():
    """The whole point: a hung login must not hold the port closed."""
    from app.main import _warm_angel_session

    never_finishes = asyncio.Event()

    async def _hang():
        await never_finishes.wait()

    with patch("app.services.angel_client.angel_session.client", side_effect=_hang):
        # If startup awaited the login, this would block until the timeout.
        await asyncio.wait_for(_warm_angel_session(), timeout=1.0)

    never_finishes.set()
    await asyncio.sleep(0)   # let the orphaned task unwind


async def test_startup_survives_a_failing_angel_login():
    """Angel being down must not stop the server from starting; the price
    path already reports its own failures."""
    from app.main import _warm_angel_session_bg

    with patch("app.services.angel_client.angel_session.client",
               new_callable=AsyncMock, side_effect=RuntimeError("Angel down")):
        await _warm_angel_session_bg()   # must not raise


async def test_health_does_not_depend_on_angel():
    """Liveness must answer even with the broker unreachable — otherwise a
    third-party outage reads as 'this machine is dead' and gets it killed."""
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    with patch("app.services.angel_client.angel_session.client",
               new_callable=AsyncMock, side_effect=RuntimeError("Angel down")):
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://test") as c:
            resp = await asyncio.wait_for(c.get("/health"), timeout=2.0)

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_login_is_bounded():
    """An unbounded login is what let a single slow call hang its caller."""
    from app.services import angel_client
    assert angel_client._LOGIN_TIMEOUT_S <= 30


def test_grace_period_leaves_room_to_boot():
    """Fly must not start failing a machine while it is still starting."""
    fly = tomllib.loads((Path(__file__).parent.parent / "fly.toml").read_text())
    check = fly["http_service"]["checks"][0]
    grace = int(check["grace_period"].rstrip("s"))
    assert grace >= 45, (
        f"grace_period={grace}s is tight for a ~72MB import on shared-cpu-1x; "
        f"15s is what turned a slow boot into a restart loop"
    )
