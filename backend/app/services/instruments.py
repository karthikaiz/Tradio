"""AngelOne instruments master (symbol → token) with a non-blocking refresh.

Why this file is shaped the way it is:

Every price request resolves its symbols through here, so anything slow in
this module becomes a stalled price feed. The original version made a price
request wait on a cold download of Angel's full scrip master — a very large
JSON — with a 60s timeout, while the Algobot caller gives up at 45s. It
therefore could not succeed from a cold cache, and because `_loaded_at` was
only assigned after a *successful* load, every following request retried the
whole download from scratch. At a 30s poll interval that is a permanent
retry storm, and it presents as `ReadTimeout` on every watched ticker at
once — which is exactly the recurring "price feed stale" outage.

The invariants that keep that from coming back:

  1. A request never blocks on a refresh. Stale tokens are served
     immediately and the refresh happens behind the request. Instrument
     tokens are effectively static, so stale data is correct data.
  2. Failure is remembered. A failed load backs off instead of re-arming on
     the very next request.
  3. The map is persisted. A restart reads from disk instead of re-fetching.
  4. The network timeout stays below the caller's budget, so a slow load
     fails fast and predictably rather than hanging the caller.
"""

import asyncio
import json
import logging
import os
import time
from pathlib import Path

import httpx

from app.services.loop_lock import LoopLock

logger = logging.getLogger(__name__)

INSTRUMENTS_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"

_token_map: dict[str, str] = {}   # "RELIANCE" → "2885"
_name_map: dict[str, str] = {}    # "RELIANCE" → "Reliance Industries Ltd"
_loaded_at: float = 0
_next_retry_at: float = 0
_refresh_task: asyncio.Task | None = None

_CACHE_TTL = 24 * 3600
# How long the DOWNLOAD may take. This is deliberately longer than any single
# caller is willing to wait: the load runs as a background task, and callers
# wait on it only for whatever slice of their own budget they can spare. A
# caller that gives up does not cancel it.
#
# It used to be the caller's timeout as well, and the comment here justified
# 25s against "the 45s budget Algobot allows for a price call". That budget is
# no longer 45s — the price path is capped by market.BATCH_DEADLINE_S (18s) —
# so a cold load could not finish inside the request that triggered it, and
# every poll blew the deadline. Callers no longer inherit this number at all.
_LOAD_TIMEOUT_S = 25
_FAILURE_BACKOFF_S = 300
_DISK_CACHE = Path(os.getenv("INSTRUMENTS_CACHE_PATH", "/tmp/tradio_instruments.json"))

_lock = LoopLock()


def is_ready() -> bool:
    """True once symbols can be resolved at all.

    Lets a caller tell "this symbol does not exist" apart from "the master has
    not loaded yet" — reported identically before, which made a cold start look
    like a bad ticker.
    """
    return bool(_token_map)


async def get_token(symbol: str) -> str | None:
    await _ensure_loaded()
    return _token_map.get(symbol.upper())


async def get_name(symbol: str) -> str | None:
    await _ensure_loaded()
    return _name_map.get(symbol.upper())


async def get_tokens_batch(
    symbols: list[str], max_wait: float | None = None
) -> dict[str, str]:
    """Returns {symbol: token} for all symbols found in instruments master.

    max_wait caps how long a cold load may hold this call up. Callers on a
    deadline pass what they can afford; None means wait for the load.
    """
    await _ensure_loaded(max_wait)
    result = {}
    for sym in symbols:
        token = _token_map.get(sym.upper())
        if token:
            result[sym.upper()] = token
    return result


def _is_fresh() -> bool:
    return bool(_token_map) and (time.time() - _loaded_at) < _CACHE_TTL


async def _ensure_loaded(max_wait: float | None = None) -> None:
    """Populate the maps, waiting at most `max_wait` on a cold load.

    Two rules, both learned the hard way:

    A caller never *owns* the load. It runs as a background task and the
    caller merely waits on it. If the caller instead awaited it directly,
    giving up would cancel the download — and with a poll every 30s the
    download would be restarted and killed forever, so no request would ever
    get tokens. Bounding the wait is only safe because the work survives it.

    A caller never waits *unbounded*. This is what broke: a cold load is a
    large download bounded at _LOAD_TIMEOUT_S, and it sat on the price path
    with no relation to the price path's own deadline.
    """
    if _is_fresh():
        return

    # Stale but usable: serve it now, refresh behind the request. A price
    # call must never wait on the scrip master — that is the stall that
    # produced the recurring feed outage.
    if _token_map:
        _schedule_refresh()
        return

    if _load_from_disk():                   # cheap, synchronous, no await
        _schedule_refresh()                 # warm now, fresh shortly
        return

    if time.time() < _next_retry_at:
        return                              # backing off — fail fast, don't storm

    _schedule_refresh()                     # one shared cold load, in background
    task = _refresh_task
    if task is None or task.done() or (max_wait is not None and max_wait <= 0):
        return
    try:
        # shield: the timeout abandons the WAIT, never the download.
        await asyncio.wait_for(asyncio.shield(task), timeout=max_wait)
    except asyncio.TimeoutError:
        logger.warning(
            "Instruments master still loading after %.1fs — caller continuing "
            "without tokens; the download is unaffected and continues",
            max_wait,
        )
    except Exception:
        pass   # _load already logged and armed the backoff


def _schedule_refresh() -> None:
    """Refresh in the background, at most one at a time."""
    global _refresh_task
    if _refresh_task is not None and not _refresh_task.done():
        return
    if time.time() < _next_retry_at:
        return

    async def _refresh():
        async with _lock.get():
            if _is_fresh():
                return
            await _load()

    try:
        _refresh_task = asyncio.create_task(_refresh())
    except RuntimeError:
        pass   # no running loop (sync context) — the next call will retry


def _load_from_disk() -> bool:
    """Populate from the on-disk snapshot. Returns True if anything loaded."""
    global _loaded_at
    try:
        if not _DISK_CACHE.exists():
            return False
        payload = json.loads(_DISK_CACHE.read_text())
        tokens = payload.get("tokens") or {}
        if not tokens:
            return False
        _token_map.clear()
        _name_map.clear()
        _token_map.update(tokens)
        _name_map.update(payload.get("names") or {})
        # Keep the original fetch time so the TTL still governs this snapshot;
        # if it is stale that triggers a background refresh, never a blocking one.
        _loaded_at = float(payload.get("fetched_at") or 0)
        logger.info("Instruments loaded from disk cache: %d NSE equities", len(_token_map))
        return True
    except Exception as e:
        logger.warning("Instruments disk cache unusable (%s) — ignoring", e)
        return False


def _save_to_disk() -> None:
    try:
        _DISK_CACHE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _DISK_CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "fetched_at": _loaded_at,
            "tokens": _token_map,
            "names": _name_map,
        }))
        tmp.replace(_DISK_CACHE)   # atomic — never leaves a half-written cache
    except Exception as e:
        logger.warning("Could not persist instruments cache (%s)", e)


async def _load():
    global _loaded_at, _next_retry_at
    logger.info("Loading AngelOne instruments master...")
    try:
        async with httpx.AsyncClient(timeout=_LOAD_TIMEOUT_S) as client:
            resp = await client.get(INSTRUMENTS_URL)
            resp.raise_for_status()
            data = resp.json()

        tokens: dict[str, str] = {}
        names: dict[str, str] = {}
        for item in data:
            if item.get("exch_seg") != "NSE":
                continue
            # NSE equities have empty instrumenttype; AMXIDX are indices
            if item.get("instrumenttype") != "":
                continue
            sym_raw = item.get("symbol", "")
            if not sym_raw.endswith("-EQ"):
                continue
            sym = sym_raw[:-3].upper()  # strip "-EQ"
            token = item.get("token", "")
            raw_name = item.get("name", sym)
            name = raw_name.title() if raw_name else sym
            if sym and token:
                tokens[sym] = token
                names[sym] = name
        # Drop the parsed master before swapping in the result — holding both
        # at once is what pushes a small machine into swap.
        del data

        if not tokens:
            raise ValueError("instruments master contained no NSE equities")

        _token_map.clear()
        _name_map.clear()
        _token_map.update(tokens)
        _name_map.update(names)
        _loaded_at = time.time()
        _next_retry_at = 0
        logger.info(f"Instruments loaded: {len(_token_map)} NSE equities")
        _save_to_disk()
    except Exception as e:
        # Remember the failure. Without this, _loaded_at stays 0 and every
        # subsequent request re-attempts the full download — one storm per
        # poll interval, which is what took the price feed down.
        _next_retry_at = time.time() + _FAILURE_BACKOFF_S
        logger.error(
            f"Failed to load instruments master: {e} — "
            f"backing off {_FAILURE_BACKOFF_S}s "
            f"(serving {len(_token_map)} cached symbols)"
        )
