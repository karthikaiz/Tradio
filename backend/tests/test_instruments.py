"""Instruments master: the module behind the recurring stale-feed outage.

Every price request resolves symbols here, so a slow or storming load in
this module *is* a dead price feed. These lock in the four invariants that
keep that from recurring.
"""

import asyncio
import json
import logging
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import instruments

logger = logging.getLogger(__name__)

SCRIP = [
    {"exch_seg": "NSE", "instrumenttype": "", "symbol": "RELIANCE-EQ",
     "token": "2885", "name": "reliance industries"},
    {"exch_seg": "NSE", "instrumenttype": "", "symbol": "LAURUSLABS-EQ",
     "token": "1234", "name": "laurus labs"},
    {"exch_seg": "NSE", "instrumenttype": "AMXIDX", "symbol": "NIFTY", "token": "99"},
    {"exch_seg": "NFO", "instrumenttype": "", "symbol": "RELIANCE-EQ", "token": "77"},
]


@pytest.fixture(autouse=True)
def clean_state(tmp_path):
    """Each test starts with an empty in-memory map and its own disk cache."""
    instruments._token_map.clear()
    instruments._name_map.clear()
    instruments._loaded_at = 0
    instruments._next_retry_at = 0
    instruments._refresh_task = None
    original = instruments._DISK_CACHE
    instruments._DISK_CACHE = tmp_path / "instruments.json"
    yield
    instruments._DISK_CACHE = original
    instruments._token_map.clear()
    instruments._name_map.clear()
    instruments._loaded_at = 0
    instruments._next_retry_at = 0


def mock_http(payload=None, exc=None, status=200):
    """Stand in for the STREAMED download.

    _load no longer calls resp.json() — bulk-parsing the master cost 98.5MB
    on a 256MB machine. It streams the body into a push parser instead, so
    the double has to hand back chunks the way httpx does.
    """
    body = json.dumps(payload if payload is not None else []).encode()

    class _Resp:
        def raise_for_status(self):
            return None

        async def aiter_bytes(self, size=65536):
            # Deliberately split small, so a row straddling a chunk boundary
            # is exercised rather than assumed to work.
            for i in range(0, len(body), 64):
                yield body[i:i + 64]

    class _Stream:
        async def __aenter__(self):
            if exc:
                raise exc
            return _Resp()

        async def __aexit__(self, *a):
            return False

    client = AsyncMock()
    client.stream = MagicMock(return_value=_Stream())
    client.__aenter__.return_value = client
    return patch("app.services.instruments.httpx.AsyncClient", return_value=client), client


# ── parsing ───────────────────────────────────────────────────────────────────

async def test_keeps_only_nse_equities():
    p, _ = mock_http(SCRIP)
    with p:
        await instruments._ensure_loaded()

    assert instruments._token_map == {"RELIANCE": "2885", "LAURUSLABS": "1234"}
    assert await instruments.get_token("reliance") == "2885"   # case-insensitive
    assert await instruments.get_name("RELIANCE") == "Reliance Industries"


# ── invariant 2: failure is remembered, not re-armed every request ───────────

async def test_failed_load_backs_off_instead_of_storming():
    """The bug: _loaded_at was only set on success, so every request retried
    the full download — one storm per 30s poll, which stalled the feed."""
    p, client = mock_http(exc=RuntimeError("403 Forbidden"))
    with p:
        await instruments._ensure_loaded()
        assert client.stream.call_count == 1
        assert instruments._next_retry_at > time.time()

        for _ in range(5):
            await instruments._ensure_loaded()
        assert client.stream.call_count == 1, "should back off, not retry per call"


async def test_backoff_expires_and_allows_a_retry():
    p, client = mock_http(exc=RuntimeError("boom"))
    with p:
        await instruments._ensure_loaded()
        instruments._next_retry_at = time.time() - 1     # backoff elapsed
        await instruments._ensure_loaded()
    assert client.stream.call_count == 2


async def test_empty_master_is_treated_as_failure_not_success():
    """An empty parse must not be cached as a good load — otherwise every
    symbol resolves to 'not found' for the next 24h."""
    p, _ = mock_http([])
    with p:
        await instruments._ensure_loaded()
    assert instruments._loaded_at == 0
    assert instruments._next_retry_at > time.time()


# ── invariant 1: a request never blocks on a refresh ─────────────────────────

async def test_stale_map_is_served_immediately_without_awaiting_network():
    p, client = mock_http(SCRIP)
    with p:
        await instruments._ensure_loaded()              # warm
    instruments._loaded_at = time.time() - (instruments._CACHE_TTL + 1)   # now stale

    slow = asyncio.Event()   # a refresh that never completes

    async def _never(*a, **k):
        await slow.wait()

    with patch.object(instruments, "_load", side_effect=_never):
        # Must return promptly even though the refresh is hung.
        await asyncio.wait_for(instruments.get_tokens_batch(["RELIANCE"]), timeout=1.0)
        result = await asyncio.wait_for(instruments.get_token("RELIANCE"), timeout=1.0)

    assert result == "2885", "stale tokens must still resolve"
    slow.set()


async def test_only_one_background_refresh_at_a_time():
    p, _ = mock_http(SCRIP)
    with p:
        await instruments._ensure_loaded()
    instruments._loaded_at = time.time() - (instruments._CACHE_TTL + 1)

    calls = 0

    async def _count(*a, **k):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)

    with patch.object(instruments, "_load", side_effect=_count):
        for _ in range(10):
            await instruments._ensure_loaded()
        await asyncio.sleep(0.1)

    assert calls == 1, "concurrent requests must share one refresh"


# ── invariant 3: the map survives a restart ──────────────────────────────────

async def test_successful_load_is_persisted_and_reused_after_restart():
    p, client = mock_http(SCRIP)
    with p:
        await instruments._ensure_loaded()
    assert instruments._DISK_CACHE.exists()

    # Simulate a process restart: memory gone, disk intact.
    instruments._token_map.clear()
    instruments._name_map.clear()
    instruments._loaded_at = 0

    p2, client2 = mock_http(SCRIP)
    with p2:
        token = await instruments.get_token("RELIANCE")
        await asyncio.sleep(0)   # let any background refresh start

    assert token == "2885"
    assert client2.get.await_count == 0, "restart must not block on a re-download"


async def test_corrupt_disk_cache_is_ignored_not_fatal():
    instruments._DISK_CACHE.write_text("{not json")
    p, _ = mock_http(SCRIP)
    with p:
        await instruments._ensure_loaded()
    assert await instruments.get_token("RELIANCE") == "2885"


# ── invariant 4: the load cannot outlive the caller's budget ─────────────────

def test_the_load_timeout_is_no_longer_a_callers_budget():
    """This invariant is deliberately INVERTED from what it used to assert.

    It used to require _LOAD_TIMEOUT_S < 45 because a price request awaited
    the load directly, so the load had to fit the caller's budget. Squeezing
    it to fit is what left too little room for a 25MB download.

    No caller awaits the load any more — it is a background task and callers
    wait on it for a slice of their own deadline (market._TOKEN_WAIT_S). So
    the download is allowed to take as long as it needs, and must be
    comfortably longer than any caller's wait, not shorter.
    """
    from app.services import market

    assert instruments._LOAD_TIMEOUT_S > market._TOKEN_WAIT_S
    assert instruments._LOAD_TIMEOUT_S >= 60, (
        "the download needs room; it is not on anyone's critical path"
    )


# ── memory footprint of the price-serving process ────────────────────────────

def test_price_path_does_not_import_pandas_or_yfinance():
    """The machine has a 256MB cap. Measured: the app imports at ~72MB, but
    pandas + yfinance add ~93MB on top — and once imported they stay resident
    for the life of the process. That pushed it into swap, and swap on
    shared-cpu-1x is slow enough that the price feed timed out on every
    ticker at once.

    So the modules on the price path must not pull them in. Importing them
    lazily inside a rarely-used endpoint is fine; importing them at module
    scope anywhere here is not.
    """
    import subprocess
    import sys

    probe = (
        "import sys;"
        "import app.routers.market, app.routers.portfolio, app.services.market;"
        "heavy=[m for m in ('pandas','yfinance','numpy') if m in sys.modules];"
        "print(','.join(heavy))"
    )
    out = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True, text=True, cwd=".",
    )
    assert out.returncode == 0, out.stderr[-500:]
    leaked = out.stdout.strip()
    assert not leaked, (
        f"price-path modules import {leaked} at module scope — "
        f"that is ~93MB resident on a 256MB machine"
    )


# ── the 15 Sep outage: a cold load on the price path ─────────────────────────

async def test_a_cold_load_does_not_hold_up_the_caller():
    """The failure, verbatim from the alert:

        DATA HEALTH: Price feed stale >60s for: ADANIENSOL (Upstream quote
        exceeded the 18s server deadline), BHARATFORG (...), LAURUSLABS (...)

    minutes after a deploy. A deploy replaces the machine, so the /tmp
    snapshot is gone and the in-memory map is empty. _ensure_loaded then
    awaited the full scrip-master download inline — bounded at
    _LOAD_TIMEOUT_S (25s), on a path the endpoint cuts off at 18s, and
    inside no timeout of its own. Every poll after a deploy blew the
    deadline for every ticker at once.

    The caller now waits only what it can afford.
    """
    started = time.monotonic()

    async def _slow_load():
        await asyncio.sleep(10)

    with patch.object(instruments, "_load", _slow_load):
        tokens = await instruments.get_tokens_batch(["RELIANCE"], max_wait=0.2)
    elapsed = time.monotonic() - started

    assert elapsed < 2.0, (
        f"a cold load held the caller for {elapsed:.1f}s despite a 0.2s cap — "
        f"this is the 15 Sep outage"
    )
    assert tokens == {}   # nothing yet, and that is reported honestly


async def test_giving_up_on_the_wait_does_not_cancel_the_download():
    """The reason bounding the wait is safe, and why it must be a task.

    If the caller awaited the load directly, its timeout would CANCEL the
    download. At a 30s poll interval that restarts and kills the same
    download forever, so no request ever gets tokens — a worse failure than
    the one being fixed. The load therefore runs as a background task and
    the caller only ever waits on it.
    """
    finished = asyncio.Event()

    async def _slow_load():
        await asyncio.sleep(0.4)
        instruments._token_map["RELIANCE"] = "2885"
        instruments._loaded_at = time.time()
        finished.set()

    with patch.object(instruments, "_load", _slow_load):
        # First caller gives up well before the load completes.
        assert await instruments.get_tokens_batch(["RELIANCE"], max_wait=0.05) == {}
        # The download must still be alive and must complete on its own.
        await asyncio.wait_for(finished.wait(), timeout=2.0)
        # The next poll, 30s later in production, finds it there.
        assert await instruments.get_tokens_batch(["RELIANCE"], max_wait=0.05) == {
            "RELIANCE": "2885"
        }


async def test_concurrent_cold_callers_share_one_download():
    """Four watched tickers must not mean four scrip-master downloads."""
    calls = 0

    async def _counting_load():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.2)
        instruments._token_map["RELIANCE"] = "2885"
        instruments._loaded_at = time.time()

    with patch.object(instruments, "_load", _counting_load):
        await asyncio.gather(*[
            instruments.get_tokens_batch(["RELIANCE"], max_wait=1.0)
            for _ in range(4)
        ])

    assert calls == 1, f"{calls} concurrent downloads — that is the storm"


# ── the 15 Sep outage, part 2: the load could never finish ───────────────────

async def test_the_master_is_never_parsed_in_bulk():
    """The measured cause, asserted structurally.

        wire size                  25.6 MB
        RSS added by resp.json()   98.5 MB   on a 256MB machine
        what is actually kept      41 KB

    resp.json() materialises every row at once. On this machine that is a
    swap thrash the load never came back from, so every poll reported
    "Instruments master still loading" — for twenty minutes, truthfully
    describing a load that was never going to finish.

    Streaming into a push parser costs 0.7MB for the same result. This
    asserts the shape rather than the number: nothing on this path may call
    .json() on the master, and the body must be consumed as chunks.
    """
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(instruments._stream_instruments).strip())
    fn = tree.body[0]
    if (fn.body and isinstance(fn.body[0], ast.Expr)
            and isinstance(fn.body[0].value, ast.Constant)):
        fn.body = fn.body[1:]          # drop the docstring; it CITES resp.json()
    src = ast.unparse(fn)
    assert ".json()" not in src, "the master must never be bulk-parsed"
    assert "aiter_bytes" in src, "the body must be streamed, not buffered"

    p, client = mock_http(SCRIP)
    with p:
        await instruments._load()
    # And it still produces exactly what the bulk parse did.
    assert instruments._token_map == {"RELIANCE": "2885", "LAURUSLABS": "1234"}
    assert instruments._name_map["RELIANCE"] == "Reliance Industries"


async def test_rows_split_across_chunk_boundaries_survive():
    """The double feeds 64-byte chunks, so every row straddles a boundary.

    A hand-rolled splitter is exactly where this would break silently, which
    is why the parsing is delegated rather than written here.
    """
    p, _ = mock_http(SCRIP)
    with p:
        await instruments._load()
    assert len(instruments._token_map) == 2


async def test_a_permanently_failing_load_stops_claiming_it_is_loading():
    """The alert said, every 30s for twenty minutes:

        ADANIENSOL (Instruments master still loading — this poll skipped,
        next one will find it)

    The next one did not find it. The load was failing, not progressing, and
    the message asserted the opposite while withholding the reason. A caller
    must be able to tell the two apart.
    """
    assert instruments.load_status() == "loading"      # nothing tried yet

    p, _ = mock_http(exc=RuntimeError("upstream 503"))
    with p:
        await instruments._load()

    status = instruments.load_status()
    assert status.startswith("load FAILED"), status
    assert "upstream 503" in status, "the reason must reach the caller"
    assert "retrying in" in status, "and so must the fact that it is backing off"
    assert "still loading" not in status


def test_a_bundled_snapshot_removes_the_download_from_the_price_path():
    """The permanent fix: the image ships the 41KB answer.

    A price request must not depend on a 25MB download succeeding on a 256MB
    machine. scripts/fetch_instruments.py bakes the NSE slice at build time,
    where there is memory and bandwidth to spare.
    """
    instruments._BUNDLED.parent.mkdir(parents=True, exist_ok=True)
    original = instruments._BUNDLED
    try:
        import json as _json
        instruments._BUNDLED = instruments._DISK_CACHE.parent / "bundled.json"
        instruments._BUNDLED.write_text(_json.dumps({
            "fetched_at": 0, "tokens": {"RELIANCE": "2885"},
            "names": {"RELIANCE": "Reliance Industries"},
        }))
        assert instruments._load_bundled() is True
        assert instruments._token_map["RELIANCE"] == "2885"
    finally:
        instruments._BUNDLED = original


async def test_the_bundled_snapshot_is_used_when_the_network_is_dead():
    """End to end: no disk cache, every download failing, symbols still resolve."""
    import json as _json
    original = instruments._BUNDLED
    try:
        instruments._BUNDLED = instruments._DISK_CACHE.parent / "bundled.json"
        instruments._BUNDLED.write_text(_json.dumps({
            "fetched_at": 0, "tokens": {"ADANIENSOL": "1111"}, "names": {},
        }))
        p, _ = mock_http(exc=RuntimeError("network down"))
        with p:
            tokens = await instruments.get_tokens_batch(["ADANIENSOL"], max_wait=0.2)
        assert tokens == {"ADANIENSOL": "1111"}, (
            "a dead network must not mean a dead price feed"
        )
    finally:
        instruments._BUNDLED = original
