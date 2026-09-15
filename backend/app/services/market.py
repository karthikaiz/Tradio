import asyncio
import logging
import time
from collections import deque
from datetime import date, datetime, timezone

from app.services.angel_client import angel_session
from app.services.instruments import get_token, get_tokens_batch

logger = logging.getLogger(__name__)

# In-memory cache: {ticker: (price, fetched_at)}
_cache: dict[str, tuple[float, datetime]] = {}
CACHE_TTL_SECONDS = 3


class MarketDataError(Exception):
    def __init__(self, ticker: str, reason: str):
        self.ticker = ticker
        self.reason = reason
        super().__init__(f"Market data unavailable for {ticker}: {reason}")


# ── Timeout budget ────────────────────────────────────────────────────────────
#
# The bot's price poll gives this service CLIENT_BUDGET_S and then abandons
# the request. Anything this service does must provably finish inside that,
# retries included — otherwise the client times out first and gets a bare
# httpx ReadTimeout carrying no reason at all, while the server is still
# working. That is not hypothetical: _BATCH_TIMEOUT_S was 10s with 2
# attempts and a 0.5s delay = 20.5s worst case against a 20.0s client
# budget, so every slow-Angel episode timed out the client by construction.
#
# The relationship is asserted in tests. Change one number and the test
# tells you which other numbers no longer fit.
CLIENT_BUDGET_S = 20.0          # what Algobot allows (tradio_client _timeout)
_MAX_FETCH_ATTEMPTS = 2
_RETRY_DELAY_S = 0.5
_BATCH_QUOTE_LIMIT = 50   # Angel's quote endpoint caps at 50 tokens per request
# 7s per attempt matches Angel's own ~7s internal read timeout, so a call
# is abandoned only once Angel itself would have given up.
# 7*2 + 0.5 = 14.5s worst case.
_BATCH_TIMEOUT_S = 7.0

# How long a price request may wait to obtain the Angel session.
#
# Acquiring the session can trigger a login, which is bounded at
# _LOGIN_TIMEOUT_S (20s) — longer than this whole endpoint is allowed to
# take. That is how "Upstream quote exceeded the 16s server deadline"
# happened with the app healthy: the wait for the session sat OUTSIDE the
# per-attempt timeout and counted toward no budget at all.
#
# A price poll must not pay for a login. The startup warmup establishes the
# session in the background, so if it is not ready yet this poll fails fast
# with a clear reason and the next one (30s later) finds it there.
_SESSION_WAIT_S = 3.0

# Hard ceiling on the whole batch, enforced by the endpoint. Answering here
# is strictly better than letting the client hit its own timeout: the client
# learns nothing from that, but a response carries the reason per ticker.
BATCH_DEADLINE_S = 18.0


def _worst_case_fetch_s(per_attempt: float = _BATCH_TIMEOUT_S) -> float:
    """Longest one chunk can take, INCLUDING the wait for the session.

    The session wait is the part that kept being left out — of the budget and
    of the test that was supposed to guard it. Every await on this path has to
    be counted, not just the one that happens to be wrapped in a timeout.
    """
    attempts = _MAX_FETCH_ATTEMPTS
    return (
        _SESSION_WAIT_S                      # obtaining the Angel session
        + per_attempt * attempts             # the quote calls themselves
        + _RETRY_DELAY_S * (attempts - 1)    # the gap between retries
    )


# ── Where the time actually goes ──────────────────────────────────────────────
#
# Client-side timing can only say "the call took 20s". It cannot say which
# stage consumed it, and guessing at that from the outside has been wrong
# repeatedly. These record the real split per request and /health reports
# them, so the bot's failure alert carries the server's own view instead of
# an inference.
_recent_timings: deque[dict] = deque(maxlen=5)


def record_price_timing(**stages: float) -> None:
    stages["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _recent_timings.append({
        k: (round(v, 2) if isinstance(v, (int, float)) else v)
        for k, v in stages.items()
    })


def recent_price_timings() -> list[dict]:
    """Stage timings for the last few price requests, newest first."""
    return list(reversed(_recent_timings))


async def get_price(ticker: str) -> float:
    """
    Returns the current INR price for a NSE ticker.
    Caches results for CACHE_TTL_SECONDS. Raises MarketDataError on failure.

    Retries once on a network-level failure (timeout, connection error).
    Angel's LTP endpoint occasionally read-times-out for a single instrument
    while every other ticker in the same /multi-price batch succeeds — one
    retry clears most of these instead of leaving that ticker's price stale
    until the next 30s poll cycle. An explicit API-level error response
    ("status": false) is not retried — that's deterministic, not transient.
    """
    now = datetime.now(timezone.utc)

    if ticker in _cache:
        cached_price, fetched_at = _cache[ticker]
        if (now - fetched_at).total_seconds() < CACHE_TTL_SECONDS:
            logger.debug(f"Cache hit for {ticker}")
            return cached_price

    token = await get_token(ticker)
    if not token:
        raise MarketDataError(ticker, "Symbol not found in instruments master")

    trading_symbol = f"{ticker}-EQ"

    last_error: Exception | None = None
    for attempt in range(1, _MAX_FETCH_ATTEMPTS + 1):
        try:
            client = await angel_session.client()
            loop = asyncio.get_event_loop()

            def _fetch():
                return client.ltpData("NSE", trading_symbol, token)

            resp = await asyncio.wait_for(
                loop.run_in_executor(None, _fetch),
                timeout=8.0,
            )
            if not resp.get("status"):
                raise MarketDataError(ticker, resp.get("message", "API error"))

            price = float(resp["data"]["ltp"])
            break
        except MarketDataError:
            raise
        except Exception as e:
            last_error = e
            if attempt < _MAX_FETCH_ATTEMPTS:
                logger.warning(f"get_price({ticker}) attempt {attempt} failed ({e}) — retrying")
                await asyncio.sleep(_RETRY_DELAY_S)
    else:
        raise MarketDataError(ticker, str(last_error)) from last_error

    if price <= 0:
        raise MarketDataError(ticker, "Returned price is zero or negative")

    _cache[ticker] = (price, now)
    logger.info(f"Price for {ticker}: ₹{price:.2f}")
    return price


async def get_prices_batch(tickers: list[str]) -> tuple[dict[str, float], dict[str, str]]:
    """
    Fetch many tickers in ONE Angel call. Returns ({ticker: price}, {ticker: error}).

    The per-ticker path (get_price) issues one blocking `requests` call per
    symbol inside the default thread pool. Fanning that out across N holdings
    every 30s multiplied load on Angel's API by N, and — because each call
    occupies a pool worker for up to the 8s timeout — a slow Angel response
    could starve the pool so later tickers timed out while merely QUEUED,
    never reaching the network. That turned one flaky symbol into an
    all-tickers-stale feed outage.

    Angel's quote endpoint takes up to 50 tokens per request (the same call
    /api/market/categories already uses for 30 symbols), so the whole watch
    list costs one request, one thread, one timeout, one retry.
    """
    prices: dict[str, float] = {}
    errors: dict[str, str] = {}
    if not tickers:
        return prices, errors

    now = datetime.now(timezone.utc)
    wanted = [t.upper() for t in tickers]

    # Serve fresh cache entries without touching the network at all.
    to_fetch: list[str] = []
    for ticker in wanted:
        cached = _cache.get(ticker)
        if cached and (now - cached[1]).total_seconds() < CACHE_TTL_SECONDS:
            prices[ticker] = cached[0]
        else:
            to_fetch.append(ticker)
    if not to_fetch:
        return prices, errors

    t_start = time.monotonic()
    token_map = await get_tokens_batch(to_fetch)
    t_tokens = time.monotonic() - t_start
    for ticker in to_fetch:
        if ticker not in token_map:
            errors[ticker] = "Symbol not found in instruments master"
    resolved = {t: tok for t, tok in token_map.items() if t in set(to_fetch)}
    if not resolved:
        return prices, errors

    ticker_by_token = {str(tok): t for t, tok in resolved.items()}
    token_list = [str(tok) for tok in resolved.values()]

    for chunk_start in range(0, len(token_list), _BATCH_QUOTE_LIMIT):
        chunk = token_list[chunk_start:chunk_start + _BATCH_QUOTE_LIMIT]
        fetched, reason = await _fetch_quote_chunk(chunk)
        if reason is not None:
            for token in chunk:
                errors[ticker_by_token[token]] = reason
            continue

        seen: set[str] = set()
        for row in fetched:
            token = str(row.get("symbolToken", ""))
            ticker = ticker_by_token.get(token)
            if not ticker:
                continue
            seen.add(token)
            ltp = row.get("ltp")
            try:
                price = float(ltp)
            except (TypeError, ValueError):
                errors[ticker] = "Quote returned no usable ltp"
                continue
            if price <= 0:
                errors[ticker] = "Returned price is zero or negative"
                continue
            prices[ticker] = price
            _cache[ticker] = (price, now)
        for token in chunk:
            if token not in seen:
                errors[ticker_by_token[token]] = "Ticker missing from batch quote response"

    total = time.monotonic() - t_start
    record_price_timing(
        tickers=len(to_fetch),
        tokens_s=t_tokens,          # instruments master resolution
        quote_s=total - t_tokens,   # Angel session + getMarketData
        total_s=total,
        priced=len(prices),
        failed=len(errors),
    )
    if total > _BATCH_TIMEOUT_S:
        logger.warning(
            "Slow batch quote: %.1fs total (tokens %.1fs, quote %.1fs) "
            "for %d ticker(s)", total, t_tokens, total - t_tokens, len(to_fetch),
        )
    if prices:
        logger.info(f"Batch quote: {len(prices)} priced, {len(errors)} failed")
    return prices, errors


async def _fetch_quote_chunk(tokens: list[str]) -> tuple[list[dict], str | None]:
    """One Angel getMarketData call, retried once. Returns (rows, error_reason)."""
    last_error: Exception | None = None
    for attempt in range(1, _MAX_FETCH_ATTEMPTS + 1):
        try:
            # Bounded: a price poll must never pay for an Angel login. The
            # background warmup owns that; if the session is not ready this
            # poll gives up quickly rather than blowing the endpoint's budget.
            try:
                client = await asyncio.wait_for(
                    angel_session.client(), timeout=_SESSION_WAIT_S
                )
            except asyncio.TimeoutError:
                raise RuntimeError(
                    f"Angel session not ready within {_SESSION_WAIT_S:.0f}s "
                    f"(still logging in) — skipping this poll"
                ) from None
            loop = asyncio.get_event_loop()

            def _fetch():
                return client.getMarketData("FULL", {"NSE": tokens})

            resp = await asyncio.wait_for(
                loop.run_in_executor(None, _fetch),
                timeout=_BATCH_TIMEOUT_S,
            )
            if not resp.get("status"):
                # Angel returns status:false for transient gateway failures too
                # (502-style "invalid response from upstream server"), so this
                # is retried rather than treated as a permanent answer.
                raise RuntimeError(resp.get("message") or "API error")
            return resp.get("data", {}).get("fetched", []) or [], None
        except Exception as e:
            last_error = e
            if attempt < _MAX_FETCH_ATTEMPTS:
                logger.warning(f"Batch quote attempt {attempt} failed ({e}) — retrying")
                await asyncio.sleep(_RETRY_DELAY_S)
    return [], str(last_error)


async def get_daily_closes(
    tickers: list[str], start: date, end: date
) -> dict[str, dict[str, float]]:
    """Daily closes per ticker: {ticker: {"YYYY-MM-DD": close}}.

    Backs the portfolio history chart off Angel's candle API — the same
    source /api/market/history uses — so the backend does not need yfinance
    (and therefore pandas) resident. A ticker that fails resolves to an empty
    dict rather than failing the whole chart.
    """
    out: dict[str, dict[str, float]] = {t: {} for t in tickers}
    if not tickers:
        return out

    token_map = await get_tokens_batch(tickers)
    fmt = "%Y-%m-%d %H:%M"
    from_s = datetime(start.year, start.month, start.day, 9, 15).strftime(fmt)
    to_s = datetime(end.year, end.month, end.day, 15, 30).strftime(fmt)

    for ticker in tickers:
        token = token_map.get(ticker.upper())
        if not token:
            continue
        try:
            client = await angel_session.client()
            loop = asyncio.get_event_loop()

            def _fetch(tok=token):
                return client.getCandleData({
                    "exchange": "NSE",
                    "symboltoken": tok,
                    "interval": "ONE_DAY",
                    "fromdate": from_s,
                    "todate": to_s,
                })

            resp = await asyncio.wait_for(
                loop.run_in_executor(None, _fetch), timeout=_BATCH_TIMEOUT_S
            )
            if not resp.get("status"):
                logger.warning("Candle fetch for %s: %s", ticker, resp.get("message"))
                continue
            closes: dict[str, float] = {}
            for row in resp.get("data") or []:
                # row: [timestamp, open, high, low, close, volume]
                try:
                    close = float(row[4])
                except (IndexError, TypeError, ValueError):
                    continue
                if close > 0:
                    closes[str(row[0])[:10]] = close
            out[ticker] = closes
        except Exception as e:
            logger.warning("Candle fetch failed for %s: %s", ticker, e)

    return out


async def get_quote(ticker: str) -> dict:
    """
    Returns full quote: ltp, percent_change, year_high, year_low, volume.
    Returns empty dict on failure (non-critical — used for enrichment only).
    """
    token = await get_token(ticker)
    if not token:
        return {}

    try:
        client = await angel_session.client()
        loop = asyncio.get_event_loop()

        def _fetch():
            return client.getMarketData("FULL", {"NSE": [token]})

        resp = await loop.run_in_executor(None, _fetch)
        if not resp.get("status"):
            return {}

        fetched = resp.get("data", {}).get("fetched", [])
        if not fetched:
            return {}

        d = fetched[0]
        return {
            "ltp": d.get("ltp"),
            "percent_change": d.get("percentChange"),
            "year_high": d.get("52WeekHigh"),
            "year_low": d.get("52WeekLow"),
            "volume": d.get("tradeVolume"),
        }
    except Exception as e:
        logger.warning(f"get_quote failed for {ticker}: {e}")
        return {}


def get_cache_info(ticker: str) -> tuple[bool, datetime | None]:
    """Returns (is_cached, fetched_at) for a ticker."""
    if ticker not in _cache:
        return False, None
    _, fetched_at = _cache[ticker]
    age = (datetime.now(timezone.utc) - fetched_at).total_seconds()
    return age < CACHE_TTL_SECONDS, fetched_at


def clear_cache():
    """Clear the price cache — used in tests."""
    _cache.clear()
