"""Fundamentals now come from the Screener snapshots Algobot writes to Supabase.

This replaced yfinance, which cost ~93MB resident alongside pandas on a
256MB machine and starved the price feed. Angel could not cover it — its API
carries no fundamentals at all — so the substitute is data the system was
already collecting daily and never reading.
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import fundamentals as f

logger = logging.getLogger(__name__)


def quarterly(metric: str, values: list[float], start: int = 1) -> list[dict]:
    """Screener's flat {quarter, metric, value} rows, chronological."""
    return [
        {"quarter": f"Q{start + i}", "metric": metric, "value": str(v)}
        for i, v in enumerate(values)
    ]


SNAPSHOT = {
    "ratios": {"stock_p_e": "28.4", "current_price": "1,500"},
    "roe_pct": 18.5,
    "debt_to_equity": 0.42,
    "ttm_eps": 52.8,
    # 5 quarters so the latest can be compared with the same quarter a year back
    "quarterly": (
        quarterly("Sales", [100, 105, 110, 115, 125])
        + quarterly("Net Profit", [10, 11, 12, 13, 15])
        + quarterly("OPM %", [20, 21, 22, 23, 24])
    ),
}


# ── field mapping ─────────────────────────────────────────────────────────────

def test_maps_the_fields_the_coach_prompt_expects():
    out = f.derive_fundamentals(SNAPSHOT)

    assert out["pe_ratio"] == 28.4
    assert out["debt_to_equity"] == 0.42
    # Screener reports percentages; yfinance gave fractions. Keep the old
    # shape so the prompt builder is untouched.
    assert out["roe"] == pytest.approx(0.185)
    assert out["profit_margin"] == pytest.approx(0.24)
    assert out["news"] == []


def test_growth_is_year_over_year_not_quarter_over_quarter():
    """yfinance's *QuarterlyGrowth fields were YoY, so the same quarter a
    year earlier is the comparison — not simply the previous quarter."""
    out = f.derive_fundamentals(SNAPSHOT)

    assert out["revenue_growth"] == pytest.approx((125 - 100) / 100)   # 25%
    assert out["eps_growth"] == pytest.approx((15 - 10) / 10)          # 50%


def test_pe_is_derived_from_price_and_eps_when_screener_omits_it():
    snap = {**SNAPSHOT, "ratios": {"current_price": "1,500"}, "ttm_eps": 50.0}
    assert f.derive_fundamentals(snap)["pe_ratio"] == 30.0


@pytest.mark.parametrize("snap", [
    {},                                              # nothing at all
    {"quarterly": [], "ratios": {}},                 # present but empty
    {"quarterly": quarterly("Sales", [100, 110])},   # too few quarters for YoY
])
def test_sparse_snapshots_degrade_to_none_rather_than_raising(snap):
    out = f.derive_fundamentals(snap)
    assert out["revenue_growth"] is None
    assert out["news"] == []


def test_zero_base_does_not_divide_by_zero():
    snap = {"quarterly": quarterly("Sales", [0, 1, 2, 3, 4])}
    assert f.derive_fundamentals(snap)["revenue_growth"] is None


def test_negative_base_growth_uses_magnitude():
    """A loss-making year turning positive is +ve growth, not -ve."""
    snap = {"quarterly": quarterly("Net Profit", [-10, -5, 0, 5, 10])}
    assert f.derive_fundamentals(snap)["eps_growth"] == pytest.approx(2.0)


# ── fetching ──────────────────────────────────────────────────────────────────

def mock_supabase(rows, status=200):
    resp = MagicMock()
    resp.status_code = status
    resp.json = lambda: rows
    client = AsyncMock()
    client.get = AsyncMock(return_value=resp)
    client.__aenter__.return_value = client
    return patch("app.services.fundamentals.httpx.AsyncClient", return_value=client), client


async def test_fetches_the_latest_snapshot_for_the_ticker():
    p, client = mock_supabase([{"data": SNAPSHOT}])
    with p, patch.object(f, "SUPABASE_ANON_KEY", "key"):
        out = await f.get_fundamentals("RELIANCE")

    assert out["pe_ratio"] == 28.4
    params = client.get.await_args.kwargs["params"]
    assert params["ticker"] == "eq.RELIANCE"
    assert params["order"] == "snapshot_date.desc"   # newest wins
    assert params["limit"] == "1"


@pytest.mark.parametrize("rows,status", [([], 200), (None, 500)])
async def test_missing_or_failed_lookup_degrades_quietly(rows, status):
    """Fundamentals only enrich the prompt. An outage must soften the advice,
    never fail the trade the user is trying to place."""
    p, _ = mock_supabase(rows or [], status=status)
    with p, patch.object(f, "SUPABASE_ANON_KEY", "key"):
        out = await f.get_fundamentals("RELIANCE")

    assert out == {
        "eps_growth": None, "revenue_growth": None, "profit_margin": None,
        "roe": None, "pe_ratio": None, "debt_to_equity": None, "news": [],
    }


async def test_network_error_is_swallowed():
    client = AsyncMock()
    client.get = AsyncMock(side_effect=RuntimeError("connection reset"))
    client.__aenter__.return_value = client
    with patch("app.services.fundamentals.httpx.AsyncClient", return_value=client), \
         patch.object(f, "SUPABASE_ANON_KEY", "key"):
        out = await f.get_fundamentals("RELIANCE")

    assert out["pe_ratio"] is None
    assert out["news"] == []


async def test_no_supabase_key_skips_the_call_entirely():
    p, client = mock_supabase([{"data": SNAPSHOT}])
    with p, patch.object(f, "SUPABASE_ANON_KEY", ""):
        out = await f.get_fundamentals("RELIANCE")

    client.get.assert_not_awaited()
    assert out["pe_ratio"] is None
