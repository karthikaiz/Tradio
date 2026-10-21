"""Symbol resolution: the module behind the recurring stale-feed outage.

Every price request resolves symbols here, so a slow or failing lookup *is* a
dead price feed. The history is in services/instruments.py; the short version
is that it spent five weeks "still loading" a 36MB file that Angel's host
drops at ~5MB, and the fix was to stop depending on that download at all.

These pin down the properties that matter: nothing waits without a bound, a
missing snapshot is survivable, and the failure text says what actually
happened.
"""

import asyncio
import importlib.util
import json
import logging
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import instruments

logger = logging.getLogger(__name__)


@pytest.fixture(autouse=True)
def clean_state(tmp_path):
    """Each test starts empty, with no snapshot and its own disk cache."""
    saved = (instruments._BUNDLED, instruments._DISK_CACHE)
    instruments._BUNDLED = tmp_path / "no-bundled.json"        # absent by default
    instruments._DISK_CACHE = tmp_path / "instruments.json"
    _reset()
    yield
    instruments._BUNDLED, instruments._DISK_CACHE = saved
    _reset()


def _reset():
    instruments._token_map.clear()
    instruments._name_map.clear()
    instruments._not_found.clear()
    instruments._loaded_at = 0
    instruments._seeded = False
    instruments._last_error = ""


def fake_angel(rows_by_symbol=None, *, status=True, message="", exc=None, delay=0.0):
    """A stand-in angel_session whose client() has a searchScrip.

    rows_by_symbol maps "RELIANCE" -> the `data` list Angel would return.
    """
    calls = []

    def search(exchange, query):
        calls.append(query)
        if delay:
            time.sleep(delay)
        if exc:
            raise exc
        return {"status": status, "message": message,
                "data": (rows_by_symbol or {}).get(query, [])}

    client = MagicMock()
    client.searchScrip = search
    session = MagicMock()
    session.client = AsyncMock(return_value=client)
    return session, calls


def row(symbol, token, exchange="NSE"):
    return {"exchange": exchange, "tradingsymbol": f"{symbol}-EQ", "symboltoken": token}


def write_snapshot(path: Path, tokens: dict, names: dict | None = None):
    path.write_text(json.dumps({"fetched_at": 1.0, "tokens": tokens, "names": names or {}}))


# ── the snapshot answers without any network ─────────────────────────────────

async def test_the_bundled_snapshot_resolves_symbols_with_no_network_at_all(tmp_path):
    """The point of the whole redesign: ordinary resolution touches nothing."""
    write_snapshot(instruments._BUNDLED, {"ADANIENSOL": "1111", "BHARATFORG": "2222"})
    session, calls = fake_angel()

    with patch.object(instruments, "angel_session", session):
        got = await instruments.get_tokens_batch(["ADANIENSOL", "bharatforg"])

    assert got == {"ADANIENSOL": "1111", "BHARATFORG": "2222"}
    assert calls == [], "a snapshot hit must not cost an API call"
    session.client.assert_not_awaited()


async def test_names_come_from_the_snapshot_and_never_wait(tmp_path):
    write_snapshot(instruments._BUNDLED, {"RELIANCE": "2885"}, {"RELIANCE": "Reliance Industries"})
    started = time.monotonic()
    assert await instruments.get_name("RELIANCE") == "Reliance Industries"
    assert await instruments.get_name("UNKNOWNCO") is None     # cosmetic: no lookup
    assert time.monotonic() - started < 0.5


async def test_a_corrupt_snapshot_is_ignored_not_fatal(tmp_path):
    instruments._BUNDLED.write_text("{not json")
    instruments._DISK_CACHE.write_text("")
    session, _ = fake_angel({"RELIANCE": [row("RELIANCE", "2885")]})
    with patch.object(instruments, "angel_session", session):
        assert await instruments.get_tokens_batch(["RELIANCE"]) == {"RELIANCE": "2885"}


# ── anything the snapshot lacks is looked up live ────────────────────────────

async def test_a_missing_symbol_is_resolved_live_and_remembered(tmp_path):
    session, calls = fake_angel({"NEWLISTING": [row("NEWLISTING", "9999")]})
    with patch.object(instruments, "angel_session", session):
        assert await instruments.get_tokens_batch(["NEWLISTING"]) == {"NEWLISTING": "9999"}
        assert await instruments.get_tokens_batch(["NEWLISTING"]) == {"NEWLISTING": "9999"}

    assert calls == ["NEWLISTING"], "the second lookup must come from memory"
    # and it survives a restart of the process within the machine's life
    _reset_memory_only()
    session2, calls2 = fake_angel()
    with patch.object(instruments, "angel_session", session2):
        assert await instruments.get_tokens_batch(["NEWLISTING"]) == {"NEWLISTING": "9999"}
    assert calls2 == []


def _reset_memory_only():
    instruments._token_map.clear()
    instruments._name_map.clear()
    instruments._seeded = False


async def test_only_the_exact_nse_equity_row_is_accepted():
    """searchScrip is a fuzzy search: RELIANCE also returns RELIANCEPP, other
    exchanges, and derivatives. Taking the first row would price the wrong
    instrument — silently."""
    rows = [
        {"exchange": "BSE", "tradingsymbol": "RELIANCE-EQ", "symboltoken": "BSE1"},
        row("RELIANCEPP", "7777"),
        {"exchange": "NSE", "tradingsymbol": "RELIANCE-BE", "symboltoken": "BE1"},
        row("RELIANCE", "2885"),
    ]
    session, _ = fake_angel({"RELIANCE": rows})
    with patch.object(instruments, "angel_session", session):
        assert await instruments.get_tokens_batch(["RELIANCE"]) == {"RELIANCE": "2885"}


# ── nothing waits without a bound ────────────────────────────────────────────

async def test_a_slow_lookup_cannot_hold_the_caller_past_its_budget():
    """The failure this module existed to prevent, in its new form. Whatever
    the upstream does, the caller gets control back inside max_wait."""
    session, _ = fake_angel({"SLOWCO": [row("SLOWCO", "1")]}, delay=3.0)
    with patch.object(instruments, "angel_session", session):
        started = time.monotonic()
        got = await instruments.get_tokens_batch(["SLOWCO"], max_wait=0.3)
        elapsed = time.monotonic() - started

    assert elapsed < 1.5, f"lookup held the caller for {elapsed:.1f}s against a 0.3s budget"
    assert got == {}
    assert "timed out" in instruments.resolution_failure("SLOWCO") \
        or "searchScrip" in instruments.resolution_failure("SLOWCO")


async def test_a_session_that_never_comes_up_cannot_hold_the_caller():
    async def never(*a, **k):
        await asyncio.sleep(60)

    session = MagicMock()
    session.client = never
    with patch.object(instruments, "angel_session", session):
        started = time.monotonic()
        got = await instruments.get_tokens_batch(["X"], max_wait=0.3)
        elapsed = time.monotonic() - started

    assert elapsed < 1.5
    assert got == {}
    assert "session not ready" in instruments.resolution_failure("X")


async def test_many_missing_symbols_converge_across_polls_instead_of_failing():
    """A cold start with more symbols than one poll's budget allows must make
    progress each time, not fail the same way forever."""
    syms = [f"S{i}" for i in range(6)]
    session, _ = fake_angel({s: [row(s, str(i))] for i, s in enumerate(syms)}, delay=0.25)

    with patch.object(instruments, "angel_session", session):
        first = await instruments.get_tokens_batch(syms, max_wait=0.8)
        assert 0 < len(first) < 6, "budget should allow some, not all"
        second = await instruments.get_tokens_batch(syms, max_wait=0.8)
        third = await instruments.get_tokens_batch(syms, max_wait=2.0)

    assert len(second) > len(first)
    assert len(third) == 6


async def test_a_zero_budget_never_touches_the_network():
    session, calls = fake_angel({"X": [row("X", "1")]})
    with patch.object(instruments, "angel_session", session):
        assert await instruments.get_tokens_batch(["X"], max_wait=0) == {}
    assert calls == []


# ── honest failure reporting ─────────────────────────────────────────────────

async def test_an_unknown_ticker_is_reported_as_unknown_and_not_re_asked():
    """"Not found" and "could not look it up" are different faults. Both used
    to read "still loading — next one will find it"."""
    session, calls = fake_angel({})          # Angel answers: nothing matches
    with patch.object(instruments, "angel_session", session):
        assert await instruments.get_tokens_batch(["NOSUCHCO"]) == {}
        assert instruments.resolution_failure("NOSUCHCO") == "Symbol not found on NSE"
        await instruments.get_tokens_batch(["NOSUCHCO"])
        await instruments.get_tokens_batch(["NOSUCHCO"])

    assert calls == ["NOSUCHCO"], "a bad ticker must not be re-asked on every 30s poll"


async def test_a_failing_lookup_says_why_and_is_not_mistaken_for_not_found():
    session, _ = fake_angel(exc=RuntimeError("upstream 503"))
    with patch.object(instruments, "angel_session", session):
        assert await instruments.get_tokens_batch(["RELIANCE"]) == {}

    reason = instruments.resolution_failure("RELIANCE")
    assert "upstream 503" in reason, "the actual error must reach the alert"
    assert "not found" not in reason.lower(), "a failure is not a missing symbol"
    assert "still loading" not in reason, "the sentence that was false for five weeks"
    # and, being a failure rather than an answer, it is retried next poll
    assert "RELIANCE" not in instruments._not_found


async def test_a_refused_lookup_reports_the_refusal():
    session, _ = fake_angel(status=False, message="Access denied because of exceeding access rate")
    with patch.object(instruments, "angel_session", session):
        assert await instruments.get_tokens_batch(["RELIANCE"]) == {}
    assert "exceeding access rate" in instruments.resolution_failure("RELIANCE")


# ── concurrency ──────────────────────────────────────────────────────────────

async def test_concurrent_polls_do_not_stampede_the_lookup_api():
    session, calls = fake_angel({"RELIANCE": [row("RELIANCE", "2885")]}, delay=0.2)
    with patch.object(instruments, "angel_session", session):
        results = await asyncio.gather(*[
            instruments.get_tokens_batch(["RELIANCE"], max_wait=3.0) for _ in range(5)
        ])
    assert all(r == {"RELIANCE": "2885"} for r in results)
    assert calls == ["RELIANCE"], f"{len(calls)} lookups for one symbol"


# ── the module must not grow a download back ─────────────────────────────────

def test_the_runtime_never_downloads_the_master():
    """Angel's master is 36MB, served at ~60KB/s, and the connection drops at
    ~5MB. Five weeks of "still loading" came from depending on it. If an HTTP
    client or the master's URL reappears here, that dependency is back."""
    src = Path(instruments.__file__).read_text()
    code = "\n".join(
        line for line in src.splitlines()
        if not line.lstrip().startswith("#")
    )
    # strip the module docstring, which narrates the history and names these
    body = code.split('"""', 2)[-1]
    for forbidden in ("httpx", "requests", "OpenAPIScripMaster", "ijson", "aiter_bytes"):
        assert forbidden not in body, f"{forbidden!r} in instruments.py: the download is back"


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

# ── the build-time bake script ───────────────────────────────────────────────

def _load_script():
    path = Path(__file__).resolve().parent.parent / "scripts" / "fetch_instruments.py"
    spec = importlib.util.spec_from_file_location("fetch_instruments_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MASTER = [
    {"exch_seg": "NSE", "instrumenttype": "", "symbol": "RELIANCE-EQ",
     "token": "2885", "name": "reliance industries"},
    {"exch_seg": "NSE", "instrumenttype": "", "symbol": "LAURUSLABS-EQ",
     "token": "1234", "name": "laurus labs"},
    {"exch_seg": "NSE", "instrumenttype": "AMXIDX", "symbol": "NIFTY", "token": "99"},
    {"exch_seg": "NFO", "instrumenttype": "OPTIDX", "symbol": "BANKNIFTY25OCT50000CE", "token": "5"},
    {"exch_seg": "NFO", "instrumenttype": "", "symbol": "RELIANCE-EQ", "token": "77"},
    {"exch_seg": "BSE", "instrumenttype": "", "symbol": "RELIANCE-EQ", "token": "88"},
]


def test_the_bake_keeps_only_nse_equities(tmp_path):
    script = _load_script()
    src = tmp_path / "master.json"
    src.write_text(json.dumps(MASTER))
    out = tmp_path / "out" / "instruments.json"

    assert script.bake(src, out) == 2
    payload = json.loads(out.read_text())
    assert payload["tokens"] == {"RELIANCE": "2885", "LAURUSLABS": "1234"}
    assert payload["names"]["RELIANCE"] == "Reliance Industries"


async def test_what_the_bake_writes_is_what_the_app_loads(tmp_path):
    """The two halves agree on the file format, end to end, with no network."""
    script = _load_script()
    src = tmp_path / "master.json"
    src.write_text(json.dumps(MASTER))
    script.bake(src, instruments._BUNDLED)

    session, calls = fake_angel()
    with patch.object(instruments, "angel_session", session):
        got = await instruments.get_tokens_batch(["RELIANCE", "LAURUSLABS"])
    assert got == {"RELIANCE": "2885", "LAURUSLABS": "1234"}
    assert calls == []


@pytest.mark.parametrize("body", [
    json.dumps(MASTER).encode()[: len(json.dumps(MASTER)) // 2],   # cut off mid-document
    b"",                                                           # empty
    b"<html>503 Service Unavailable</html>",                       # error page saved as the file
    json.dumps([MASTER[2], MASTER[3]]).encode(),                   # valid, but no equities
])
def test_a_bad_download_writes_no_snapshot_and_exits_nonzero(tmp_path, body, capsys):
    """Failure must leave NO file, so the image carries nothing rather than a
    partial map, and must say so through its exit status. The previous version
    returned 0 on every failure, so its own crash-on-every-run bug was
    invisible until it ran in CI."""
    script = _load_script()
    src = tmp_path / "master.json"
    src.write_bytes(body)
    out = tmp_path / "instruments.json"

    assert script.main(["fetch_instruments.py", str(src), str(out)]) == 1
    assert not out.exists()
    assert not out.with_suffix(".tmp").exists()
    assert "could not bake" in capsys.readouterr().err


def test_a_missing_download_is_reported_not_raised(tmp_path):
    script = _load_script()
    assert script.main(["fetch_instruments.py", str(tmp_path / "absent.json"),
                        str(tmp_path / "o.json")]) == 1
