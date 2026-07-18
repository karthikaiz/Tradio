"""Tests for PriceStream lifecycle — Task 5 (safety audit).

Verifies the Angel WS is rebuilt after death (closed callback or dead thread),
that rebuilds respect bounded backoff, and that health() reports honestly.
SmartWebSocketV2 is mocked — no network, no credentials.
"""

import sys
import time
import types
from unittest.mock import MagicMock

import pytest

from app.services.price_stream import PriceStream


class FakeClient:
    access_token = "tok"
    userId = "uid"
    feed_token = "feed"


@pytest.fixture
def fake_smartapi(monkeypatch):
    """Install a fake SmartApi.smartWebSocketV2 module; returns the list of
    constructed fake WS instances."""
    created = []

    class FakeWS:
        def __init__(self, *args, **kwargs):
            created.append(self)
            self.on_open = None
            self.on_data = None
            self.on_error = None
            self.on_close = None

        def connect(self):
            # Block like the real connect() so the thread stays alive
            # until the test ends (daemon thread, process exit kills it).
            time.sleep(30)

        def subscribe(self, *a, **k):
            pass

    mod = types.ModuleType("SmartApi.smartWebSocketV2")
    mod.SmartWebSocketV2 = FakeWS
    pkg = types.ModuleType("SmartApi")
    pkg.smartWebSocketV2 = mod
    monkeypatch.setitem(sys.modules, "SmartApi", pkg)
    monkeypatch.setitem(sys.modules, "SmartApi.smartWebSocketV2", mod)
    monkeypatch.setenv("ANGEL_API_KEY", "test-key")
    return created


async def test_starts_once_while_alive(fake_smartapi):
    ps = PriceStream()
    await ps.ensure_started(FakeClient())
    await ps.ensure_started(FakeClient())
    assert len(fake_smartapi) == 1
    assert ps.health()["started"] is True
    assert ps.health()["thread_alive"] is True


async def test_rebuild_after_close_callback(fake_smartapi):
    ps = PriceStream()
    await ps.ensure_started(FakeClient())
    ws1 = fake_smartapi[0]

    # Angel closes the connection (e.g. max retries exhausted)
    ws1.on_close(ws1)
    assert ps.health()["started"] is False
    assert ps.health()["connected"] is False

    # Clear backoff so rebuild happens immediately in test
    ps._backoff_s = 0.0
    await ps.ensure_started(FakeClient())
    assert len(fake_smartapi) == 2
    assert ps.health()["started"] is True
    assert ps.health()["restart_count"] == 2


async def test_rebuild_when_thread_dead_without_close(fake_smartapi):
    """Thread dies without on_close firing — _started still True, but
    ensure_started must detect the dead thread and rebuild."""
    ps = PriceStream()
    await ps.ensure_started(FakeClient())

    dead = MagicMock()
    dead.is_alive.return_value = False
    ps._thread = dead
    ps._backoff_s = 0.0

    await ps.ensure_started(FakeClient())
    assert len(fake_smartapi) == 2


async def test_backoff_defers_rapid_rebuilds(fake_smartapi):
    ps = PriceStream()
    await ps.ensure_started(FakeClient())
    fake_smartapi[0].on_close(fake_smartapi[0])

    # backoff window still open (set at first start) → no rebuild
    assert ps._backoff_s >= 5
    await ps.ensure_started(FakeClient())
    assert len(fake_smartapi) == 1

    # window elapsed → rebuild allowed
    ps._last_start_ts = time.time() - ps._backoff_s - 1
    await ps.ensure_started(FakeClient())
    assert len(fake_smartapi) == 2


async def test_backoff_grows_and_resets_on_open(fake_smartapi):
    ps = PriceStream()
    await ps.ensure_started(FakeClient())
    first_backoff = ps._backoff_s
    assert first_backoff == 5

    fake_smartapi[0].on_close(fake_smartapi[0])
    ps._last_start_ts = time.time() - ps._backoff_s - 1
    await ps.ensure_started(FakeClient())
    assert ps._backoff_s == 10  # doubled

    # successful open resets the backoff
    fake_smartapi[1].on_open(fake_smartapi[1])
    assert ps._backoff_s == 0.0
    assert ps.health()["connected"] is True


async def test_health_reports_error_and_tick_age(fake_smartapi):
    ps = PriceStream()
    await ps.ensure_started(FakeClient())
    ws = fake_smartapi[0]

    assert ps.health()["last_tick_age_s"] is None
    ws.on_error(ws, "Connection closed")
    assert ps.health()["last_error"] == "Connection closed"

    ws.on_data(ws, {"token": "unknown"}, None, None)
    age = ps.health()["last_tick_age_s"]
    assert age is not None and age < 2
