"""Fundamentals from the Screener snapshots Algobot already collects.

Why not yfinance: importing it pulls in pandas, and the pair measures ~93MB
resident on a machine with a 256MB cap and a ~72MB baseline. Loading that
for prompt enrichment pushed the process into swap, and swap on
shared-cpu-1x is slow enough to time the price feed out on every ticker.

Why not Angel: SmartAPI is orders, positions and market data — ltpData,
getMarketData, getCandleData. It carries no fundamentals, no news and no
sector, so it cannot cover this at all.

Why Supabase: Algobot's Screener.in collector already writes a dated
snapshot per ticker every trading day (scripts/collect_screener.py), and
nothing in Tradio read it. It is India-specific and more reliable for NSE
names than yfinance, it costs one HTTP call with no new dependency, and the
data is already being paid for.

The only thing lost in the move is news headlines; Screener carries none.
"""

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

SUPABASE_PROJECT_REF = os.getenv("SUPABASE_PROJECT_REF", "etnpvqalehpzdrrzugmn")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
_SB_BASE = f"https://{SUPABASE_PROJECT_REF}.supabase.co"

_TIMEOUT_S = 6.0


def _num(v: Any) -> float | None:
    """Screener values arrive as strings with commas, %, and currency marks."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").replace("%", "").replace("₹", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _quarter_series(quarterly: list[dict], metric_contains: str) -> list[float]:
    """Values for one quarterly row (e.g. Sales), oldest first.

    Screener's quarterly table is a flat list of {quarter, metric, value},
    with columns already in chronological order.
    """
    seen: dict[str, float] = {}
    for row in quarterly or []:
        metric = str(row.get("metric", "")).lower()
        if metric_contains not in metric:
            continue
        q = row.get("quarter")
        if q is None or q in seen:
            continue
        val = _num(row.get("value"))
        if val is not None:
            seen[q] = val
    return list(seen.values())


def _yoy_growth(values: list[float]) -> float | None:
    """Latest quarter vs the same quarter a year earlier (4 quarters back).

    Returned as a fraction, matching what the yfinance fields used to give
    (earningsQuarterlyGrowth / revenueQuarterlyGrowth), so the prompt
    formatting is unchanged.
    """
    if len(values) < 5:
        return None
    latest, year_ago = values[-1], values[-5]
    if year_ago == 0:
        return None
    return (latest - year_ago) / abs(year_ago)


def derive_fundamentals(snapshot: dict) -> dict:
    """Map a Screener snapshot onto the fields the coach prompt expects."""
    ratios = snapshot.get("ratios") or {}
    quarterly = snapshot.get("quarterly") or []

    pe = _num(ratios.get("stock_p_e"))
    if pe is None:
        price, eps = _num(ratios.get("current_price")), _num(snapshot.get("ttm_eps"))
        if price and eps and eps > 0:
            pe = round(price / eps, 2)

    # Screener reports ROE and OPM as percentages; yfinance used fractions.
    roe = _num(snapshot.get("roe_pct"))
    opm = _quarter_series(quarterly, "opm")

    return {
        "eps_growth": _yoy_growth(_quarter_series(quarterly, "net profit")),
        "revenue_growth": _yoy_growth(_quarter_series(quarterly, "sales")),
        "profit_margin": (opm[-1] / 100) if opm else None,
        "roe": (roe / 100) if roe is not None else None,
        "pe_ratio": pe,
        "debt_to_equity": _num(snapshot.get("debt_to_equity")),
        "news": [],   # Screener carries no headlines
    }


async def fetch_snapshot(ticker: str) -> dict | None:
    """Most recent Screener snapshot for a ticker, or None.

    Never raises: fundamentals only enrich the coach prompt, so an outage
    here must degrade the advice, not fail the request.
    """
    if not SUPABASE_ANON_KEY:
        logger.debug("SUPABASE_ANON_KEY unset — skipping fundamentals")
        return None
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
            resp = await client.get(
                f"{_SB_BASE}/rest/v1/screener_snapshots",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                },
                params={
                    "ticker": f"eq.{ticker.upper()}",
                    "order": "snapshot_date.desc",
                    "limit": "1",
                    "select": "data",
                },
            )
        if resp.status_code != 200:
            logger.warning("Screener snapshot lookup for %s: HTTP %s", ticker, resp.status_code)
            return None
        rows = resp.json()
        return rows[0]["data"] if rows else None
    except Exception as e:
        logger.warning("Screener snapshot lookup failed for %s: %s", ticker, e)
        return None


async def get_fundamentals(ticker: str) -> dict:
    """Coach-shaped fundamentals. Empty-but-valid when unavailable."""
    empty = {
        "eps_growth": None, "revenue_growth": None, "profit_margin": None,
        "roe": None, "pe_ratio": None, "debt_to_equity": None, "news": [],
    }
    snapshot = await fetch_snapshot(ticker)
    if not snapshot:
        return empty
    try:
        return derive_fundamentals(snapshot)
    except Exception as e:
        logger.warning("Could not derive fundamentals for %s: %s", ticker, e)
        return empty
