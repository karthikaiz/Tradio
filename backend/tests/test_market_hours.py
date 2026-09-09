"""Coverage for the market-hours guard and the loop-safe locks.

market_hours gates every buy and sell, and had no tests at all — the only
thing exercising it was the wall clock during a CI run, which is exactly
what made the trade/journal/portfolio suites pass in the morning and fail
after 15:30 IST.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.services.loop_lock import LoopLock
from app.services.market_hours import IST, get_market_status, is_market_open

logger = logging.getLogger(__name__)


def ist(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


# ── get_market_status ─────────────────────────────────────────────────────────

def test_open_during_trading_hours():
    status = get_market_status(ist(2026, 9, 9, 10, 0))   # Wednesday
    assert status["open"] is True
    assert status["reason"] == ""
    assert status["next_open"] is None


@pytest.mark.parametrize("hh,mm,fragment", [
    (9,  0,  "not yet open"),      # before the bell
    (15, 45, "trading ended"),     # after the close
])
def test_closed_outside_trading_hours(hh, mm, fragment):
    status = get_market_status(ist(2026, 9, 9, hh, mm))
    assert status["open"] is False
    assert fragment in status["reason"]
    assert status["next_open"]


@pytest.mark.parametrize("hh,mm,expected", [
    (9,  14, False),   # one minute early
    (9,  15, True),    # the bell itself is open
    (15, 29, True),    # last open minute
    (15, 30, False),   # close is exclusive
])
def test_open_close_boundaries(hh, mm, expected):
    assert is_market_open(ist(2026, 9, 9, hh, mm)) is expected


@pytest.mark.parametrize("day,name", [(12, "Saturday"), (13, "Sunday")])
def test_closed_on_weekend(day, name):
    status = get_market_status(ist(2026, 9, day, 10, 0))
    assert status["open"] is False
    assert name in status["reason"]


def test_closed_on_holiday_even_on_a_weekday():
    # 14 Sep 2026 is a Monday AND Ganesh Chaturthi
    status = get_market_status(ist(2026, 9, 14, 10, 0))
    assert status["open"] is False
    assert "public holiday" in status["reason"]


def test_next_open_skips_weekend_and_holiday_and_lands_on_the_bell():
    # Friday 11 Sep after close. Sat 12 and Sun 13 are the weekend, and
    # Mon 14 is Ganesh Chaturthi — so the next open is Tuesday 15th 09:15.
    status = get_market_status(ist(2026, 9, 11, 16, 0))
    assert status["open"] is False
    nxt = datetime.fromisoformat(status["next_open"])
    assert (nxt.date().isoformat(), nxt.hour, nxt.minute) == ("2026-09-15", 9, 15)
    assert is_market_open(nxt) is True


def test_naive_and_foreign_timezones_are_converted_to_ist():
    # 06:00 UTC == 11:30 IST — open, despite being outside 9:15-15:30 UTC
    utc_now = datetime(2026, 9, 9, 6, 0, tzinfo=timezone.utc)
    assert is_market_open(utc_now) is True


# ── the endpoint guard itself ─────────────────────────────────────────────────

@pytest.mark.real_market_hours
async def test_buy_rejected_when_market_closed(client):
    with patch("app.routers.trade.get_market_status", return_value={
        "open": False,
        "reason": "Market closed — trading ended at 3:30 PM IST",
        "next_open": "2026-09-10T09:15:00+05:30",
    }):
        resp = await client.post("/api/trade/buy", json={"ticker": "RELIANCE", "quantity": 1})

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["error"] == "Market closed"
    assert "3:30 PM" in detail["reason"]
    assert detail["next_open"]


@pytest.mark.real_market_hours
async def test_sell_rejected_when_market_closed(client):
    with patch("app.routers.trade.get_market_status", return_value={
        "open": False, "reason": "Market closed — Saturday", "next_open": None,
    }):
        resp = await client.post("/api/trade/sell", json={"ticker": "RELIANCE", "quantity": 1})

    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "Market closed"


# ── LoopLock ──────────────────────────────────────────────────────────────────

def test_loop_lock_survives_a_new_event_loop():
    """The regression that made test_coach pass alone but fail in a full run:
    a module-level asyncio.Lock binds to the first loop that awaits it and
    raises 'bound to a different event loop' in every later test's loop."""
    lock = LoopLock()

    async def use_it():
        async with lock.get():
            return True

    assert asyncio.run(use_it()) is True
    assert asyncio.run(use_it()) is True   # fresh loop — must not raise


def test_loop_lock_returns_the_same_lock_within_one_loop():
    lock = LoopLock()

    async def twice():
        return lock.get() is lock.get()

    assert asyncio.run(twice()) is True


async def test_instruments_lock_is_reusable_across_loops():
    """instruments._lock is a module-level singleton shared by every test."""
    from app.services import instruments
    with patch.object(instruments, "_load", new_callable=AsyncMock):
        instruments._token_map.clear()
        await instruments._ensure_loaded()
    assert True   # a poisoned lock would have raised RuntimeError above
