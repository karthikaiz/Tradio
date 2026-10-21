"""Symbol -> Angel token resolution.

Every price request resolves its symbols here, so anything slow in this
module is a stalled price feed. That is why it has been rewritten more than
once, and why it is now deliberately small.

What went wrong, in order, because each fix looked right and was not:

  1. It downloaded Angel's whole scrip master (OpenAPIScripMaster.json) inside
     the request that needed one symbol, with a 60s timeout against a 45s
     caller. It could not succeed from cold, and every retry started over.
  2. The download was moved to a background task and bounded. Better, but it
     still treated the download as something that could succeed.
  3. It was streamed instead of bulk-parsed (98MB -> 0.7MB). Also real, and
     also beside the point. Running the download on a CI runner finally showed
     what was actually happening:

         peer closed connection without sending complete message body
         (received 5,094,045 bytes, expected 36,292,596) after 86 seconds

     The file is 36MB, Angel's host serves it at roughly 60KB/s, and it drops
     the connection part-way. Nothing downstream of the download was ever the
     problem: it never got far enough to be parsed. Every attempt failed, the
     message said "still loading — next one will find it", and the next one
     failed the same way.

So the runtime no longer downloads the master at all. Nothing here needs all
of it — every caller resolves specific, already-known tickers — and instrument
tokens do not change, so there is nothing to refresh on a timer.

  * Build time:  scripts/fetch_instruments.py bakes the NSE-equity slice
                 (~100KB) into the image from a retried, resumable download
                 done on the deploy runner, which has the time and memory.
  * Run time:    the snapshot answers almost everything. Anything it lacks
                 (a newly listed symbol) is resolved on demand through Angel's
                 searchScrip — the same API host that already serves logins
                 and quotes — and remembered.

If the Angel session works, resolution works; if it does not, quotes fail
regardless. Resolution adds no dependency the price path did not already have.

Nothing in this module may wait without a bound. Callers pass the time they
can afford; the default is short.
"""

import asyncio
import json
import logging
import os
import time
from pathlib import Path

from app.services.angel_client import angel_session
from app.services.loop_lock import LoopLock

logger = logging.getLogger(__name__)

_token_map: dict[str, str] = {}   # "RELIANCE" -> "2885"
_name_map: dict[str, str] = {}    # "RELIANCE" -> "Reliance Industries"
_loaded_at: float = 0
_seeded = False

# Baked into the image at deploy time (scripts/fetch_instruments.py).
_BUNDLED = Path(__file__).resolve().parent.parent / "data" / "instruments.json"
# Remembers symbols resolved on demand, for the life of the machine. Fly's
# root filesystem does not survive a stop/start, so this is a convenience, not
# something anything depends on.
_DISK_CACHE = Path(os.getenv("INSTRUMENTS_CACHE_PATH", "/tmp/tradio_instruments.json"))

# One searchScrip call. Short: it is a tiny request, and the caller's own
# budget is what actually bounds the total.
_RESOLVE_CALL_TIMEOUT_S = 4.0
# How long a caller waits for on-demand resolution when it does not say.
_DEFAULT_WAIT_S = 5.0
# A symbol Angel says does not exist is not asked about again for a while.
_NOT_FOUND_TTL_S = 600
_not_found: dict[str, float] = {}
_last_error = ""

# Resolving is serialised: concurrent polls must not stampede searchScrip.
_lock = LoopLock()


# ── Public API ────────────────────────────────────────────────────────────────

async def get_tokens_batch(
    symbols: list[str], max_wait: float = _DEFAULT_WAIT_S
) -> dict[str, str]:
    """Returns {symbol: token} for every symbol that could be resolved.

    Symbols missing from the snapshot are looked up live, within max_wait.
    Anything unresolved is simply absent — see resolution_failure() for why.
    """
    _seed()
    wanted = [s.upper() for s in symbols]
    result = {s: _token_map[s] for s in wanted if s in _token_map}

    missing = [s for s in dict.fromkeys(wanted) if s not in result and not _is_known_absent(s)]
    if missing and max_wait > 0:
        found = await _resolve(missing, max_wait)
        result.update(found)
    return result


async def get_token(symbol: str, max_wait: float = _DEFAULT_WAIT_S) -> str | None:
    return (await get_tokens_batch([symbol], max_wait)).get(symbol.upper())


async def get_name(symbol: str) -> str | None:
    """Display name, from the snapshot only.

    Purely cosmetic, so it never touches the network and never waits; callers
    already fall back to the ticker itself.
    """
    _seed()
    return _name_map.get(symbol.upper())


def resolution_failure(symbol: str) -> str:
    """Why a symbol has no token, in words a caller can put in an alert.

    "Not found" and "could not look it up" are different faults. Reporting
    both as one was how a failing load was described, for twenty minutes, as
    "still loading — next one will find it".
    """
    if _is_known_absent(symbol.upper()):
        return "Symbol not found on NSE"
    return f"Symbol lookup unavailable: {_last_error or 'timed out'}"


# ── Snapshot ──────────────────────────────────────────────────────────────────

def _seed() -> None:
    """Load the baked snapshot, then anything remembered on disk. Once."""
    global _seeded
    if _seeded:
        return
    _seeded = True
    _load_snapshot(_BUNDLED, "bundled snapshot")
    _load_snapshot(_DISK_CACHE, "disk cache")


def _load_snapshot(path: Path, label: str) -> bool:
    """Merge a snapshot file into the maps. Unusable files are ignored."""
    global _loaded_at
    try:
        if not path.exists():
            return False
        payload = json.loads(path.read_text())
        tokens = payload.get("tokens") or {}
        if not tokens:
            return False
        _token_map.update(tokens)
        _name_map.update(payload.get("names") or {})
        _loaded_at = max(_loaded_at, float(payload.get("fetched_at") or 0))
        logger.info("Instruments: %d symbols from %s", len(tokens), label)
        return True
    except Exception as e:
        logger.warning("Instruments %s unusable (%s) — ignoring", label, e)
        return False


def _save_to_disk() -> None:
    try:
        _DISK_CACHE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _DISK_CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "fetched_at": _loaded_at or time.time(),
            "tokens": _token_map,
            "names": _name_map,
        }))
        tmp.replace(_DISK_CACHE)   # atomic — never leaves a half-written cache
    except Exception as e:
        logger.warning("Could not persist instruments cache (%s)", e)


# ── On-demand resolution ──────────────────────────────────────────────────────

def _is_known_absent(symbol: str) -> bool:
    until = _not_found.get(symbol)
    if until is None:
        return False
    if time.monotonic() >= until:
        del _not_found[symbol]
        return False
    return True


async def _resolve(symbols: list[str], max_wait: float) -> dict[str, str]:
    """Look symbols up through Angel's searchScrip, within max_wait in total.

    Whatever finishes in time is kept; the rest is left for the next poll
    (30s later), so a cold start with many symbols converges rather than
    failing. Nothing here can outlive max_wait.
    """
    global _last_error
    deadline = time.monotonic() + max_wait
    found: dict[str, str] = {}

    try:
        # A poll must not pay for a login: the startup warmup owns that.
        client = await asyncio.wait_for(angel_session.client(), timeout=max(0.1, max_wait))
    except Exception as e:
        _last_error = f"Angel session not ready ({type(e).__name__})"
        logger.warning("Symbol lookup skipped: %s", _last_error)
        return found

    loop = asyncio.get_running_loop()
    async with _lock.get():
        for symbol in symbols:
            left = deadline - time.monotonic()
            if left <= 0:
                _last_error = f"ran out of the {max_wait:.0f}s lookup budget"
                break
            if symbol in _token_map:          # resolved by a concurrent caller
                found[symbol] = _token_map[symbol]
                continue
            try:
                resp = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda s=symbol: client.searchScrip("NSE", s)),
                    timeout=min(_RESOLVE_CALL_TIMEOUT_S, left),
                )
            except Exception as e:
                _last_error = f"searchScrip failed ({type(e).__name__}: {e})" if str(e) \
                    else f"searchScrip failed ({type(e).__name__})"
                logger.warning("Symbol lookup for %s: %s", symbol, _last_error)
                continue

            if not resp.get("status"):
                _last_error = f"searchScrip refused: {resp.get('message') or 'no reason given'}"
                continue

            token = _pick_equity_token(symbol, resp.get("data") or [])
            if token:
                _token_map[symbol] = token
                found[symbol] = token
            else:
                # Angel answered and has no such equity: remember that, so a
                # bad ticker is not re-asked on every 30s poll.
                _not_found[symbol] = time.monotonic() + _NOT_FOUND_TTL_S

    if found:
        _last_error = ""
        _save_to_disk()
    return found


def _pick_equity_token(symbol: str, rows: list[dict]) -> str | None:
    """The NSE cash-equity row for exactly this symbol (RELIANCE-EQ)."""
    want = f"{symbol}-EQ"
    for row in rows:
        if row.get("exchange") != "NSE":
            continue
        if str(row.get("tradingsymbol", "")).upper() != want:
            continue
        token = row.get("symboltoken")
        if token:
            return str(token)
    return None
