import asyncio
import logging
import time
import httpx

logger = logging.getLogger(__name__)

INSTRUMENTS_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"

_token_map: dict[str, str] = {}   # "RELIANCE" → "2885"
_name_map: dict[str, str] = {}    # "RELIANCE" → "Reliance Industries Ltd"
_loaded_at: float = 0
_CACHE_TTL = 24 * 3600
_lock = asyncio.Lock()


async def get_token(symbol: str) -> str | None:
    await _ensure_loaded()
    return _token_map.get(symbol.upper())


async def get_name(symbol: str) -> str | None:
    await _ensure_loaded()
    return _name_map.get(symbol.upper())


async def get_tokens_batch(symbols: list[str]) -> dict[str, str]:
    """Returns {symbol: token} for all symbols found in instruments master."""
    await _ensure_loaded()
    result = {}
    for sym in symbols:
        token = _token_map.get(sym.upper())
        if token:
            result[sym.upper()] = token
    return result


async def _ensure_loaded():
    if _token_map and time.time() - _loaded_at < _CACHE_TTL:
        return
    async with _lock:
        if _token_map and time.time() - _loaded_at < _CACHE_TTL:
            return
        await _load()


async def _load():
    global _loaded_at
    logger.info("Loading AngelOne instruments master...")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(INSTRUMENTS_URL)
            resp.raise_for_status()
            data = resp.json()

        _token_map.clear()
        _name_map.clear()

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
                _token_map[sym] = token
                _name_map[sym] = name

        _loaded_at = time.time()
        logger.info(f"Instruments loaded: {len(_token_map)} NSE equities")
    except Exception as e:
        logger.error(f"Failed to load instruments master: {e}")
