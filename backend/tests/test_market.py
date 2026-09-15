import asyncio
import time
import logging
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, AsyncMock, MagicMock

from app.services.market import get_price, get_cache_info, clear_cache, MarketDataError

logger = logging.getLogger(__name__)


@pytest.fixture(autouse=True)
def reset_cache():
    clear_cache()
    yield
    clear_cache()


def make_mock_client(ltp=None, error=False):
    mock_client = MagicMock()
    if error:
        mock_client.ltpData.side_effect = Exception("Connection error")
    else:
        mock_client.ltpData.return_value = {
            "status": True,
            "data": {
                "ltp": ltp,
                "tradingsymbol": "RELIANCE-EQ",
                "exchange": "NSE",
                "symboltoken": "2885",
            },
        }
    return mock_client


async def test_get_price_returns_ltp():
    mock_client = make_mock_client(ltp=2954.50)
    with patch("app.services.market.get_token", new_callable=AsyncMock, return_value="2885"), \
         patch("app.services.market.angel_session") as mock_session:
        mock_session.client = AsyncMock(return_value=mock_client)
        price = await get_price("RELIANCE")

    assert price == 2954.50
    logger.info("Verified: get_price returns ltp from SmartAPI")


async def test_get_price_raises_when_token_not_found():
    with patch("app.services.market.get_token", new_callable=AsyncMock, return_value=None):
        with pytest.raises(MarketDataError) as exc_info:
            await get_price("BADTICKER")

    assert exc_info.value.ticker == "BADTICKER"
    logger.info("Verified: get_price raises MarketDataError when symbol not in instruments")


async def test_get_price_caches_result():
    mock_client = make_mock_client(ltp=2900.00)
    with patch("app.services.market.get_token", new_callable=AsyncMock, return_value="2885"), \
         patch("app.services.market.angel_session") as mock_session:
        mock_session.client = AsyncMock(return_value=mock_client)
        price1 = await get_price("RELIANCE")
        price2 = await get_price("RELIANCE")

    assert price1 == price2 == 2900.00
    assert mock_client.ltpData.call_count == 1
    logger.info("Verified: second call within TTL returns cached price, API called only once")


async def test_get_price_cache_expires():
    mock_client = make_mock_client(ltp=2900.00)
    with patch("app.services.market.get_token", new_callable=AsyncMock, return_value="2885"), \
         patch("app.services.market.angel_session") as mock_session:
        mock_session.client = AsyncMock(return_value=mock_client)
        await get_price("RELIANCE")

        # Manually expire the cache entry
        import app.services.market as market_module
        ticker, (price, fetched_at) = list(market_module._cache.items())[0]
        market_module._cache[ticker] = (price, fetched_at - timedelta(seconds=61))

        await get_price("RELIANCE")

    assert mock_client.ltpData.call_count == 2
    logger.info("Verified: expired cache triggers a fresh SmartAPI fetch")


async def test_get_price_raises_on_api_error():
    mock_client = make_mock_client(error=True)
    with patch("app.services.market.get_token", new_callable=AsyncMock, return_value="2885"), \
         patch("app.services.market.angel_session") as mock_session, \
         patch("app.services.market._RETRY_DELAY_S", 0):
        mock_session.client = AsyncMock(return_value=mock_client)
        with pytest.raises(MarketDataError) as exc_info:
            await get_price("RELIANCE")

    assert exc_info.value.ticker == "RELIANCE"
    # A network-level failure gets one retry before giving up — this is
    # what turns a single transient Angel timeout into a recovered price
    # instead of an immediate stale-feed alert for that ticker.
    assert mock_client.ltpData.call_count == 2
    logger.info("Verified: SmartAPI exception retries once then raises MarketDataError")


async def test_get_price_recovers_after_one_transient_failure():
    mock_client = MagicMock()
    mock_client.ltpData.side_effect = [
        Exception("HTTPSConnectionPool(...): Read timed out. (read timeout=7)"),
        {
            "status": True,
            "data": {"ltp": 2954.50, "tradingsymbol": "RELIANCE-EQ",
                      "exchange": "NSE", "symboltoken": "2885"},
        },
    ]
    with patch("app.services.market.get_token", new_callable=AsyncMock, return_value="2885"), \
         patch("app.services.market.angel_session") as mock_session, \
         patch("app.services.market._RETRY_DELAY_S", 0):
        mock_session.client = AsyncMock(return_value=mock_client)
        price = await get_price("RELIANCE")

    assert price == 2954.50
    assert mock_client.ltpData.call_count == 2
    logger.info("Verified: a transient failure on attempt 1 doesn't fail the request when attempt 2 succeeds")


async def test_get_price_api_status_false_not_retried():
    """An explicit {"status": false} response is deterministic (bad symbol,
    market closed for that segment, etc.) — retrying it wastes the retry
    budget on something that will never succeed."""
    mock_client = MagicMock()
    mock_client.ltpData.return_value = {"status": False, "message": "Invalid token"}
    with patch("app.services.market.get_token", new_callable=AsyncMock, return_value="2885"), \
         patch("app.services.market.angel_session") as mock_session, \
         patch("app.services.market._RETRY_DELAY_S", 0):
        mock_session.client = AsyncMock(return_value=mock_client)
        with pytest.raises(MarketDataError):
            await get_price("RELIANCE")

    assert mock_client.ltpData.call_count == 1
    logger.info("Verified: explicit API-level error is not retried")


async def test_market_price_endpoint_200(client):
    mock_client = make_mock_client(ltp=2954.50)
    with patch("app.services.market.get_token", new_callable=AsyncMock, return_value="2885"), \
         patch("app.services.market.angel_session") as mock_session:
        mock_session.client = AsyncMock(return_value=mock_client)
        response = await client.get("/api/market/price?ticker=RELIANCE")

    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "RELIANCE"
    assert data["price"] == 2954.50
    assert "cached" in data
    assert "as_of" in data
    logger.info("Verified: GET /api/market/price returns 200 with ticker, price, cached, as_of")


async def test_market_price_endpoint_503_on_error(client):
    with patch("app.services.market.get_token", new_callable=AsyncMock, return_value=None):
        response = await client.get("/api/market/price?ticker=BADTICKER")

    assert response.status_code == 503
    data = response.json()
    assert data["detail"]["error"] == "Market data unavailable"
    assert data["detail"]["ticker"] == "BADTICKER"
    logger.info("Verified: GET /api/market/price returns 503 when symbol not found")


# ── Batch quote path (root-cause fix for recurring stale-feed outages) ────────

def make_batch_client(rows, status=True, error=None):
    """Mock whose getMarketData returns Angel's FULL-mode payload shape."""
    c = MagicMock()
    if error:
        c.getMarketData.side_effect = error
    else:
        c.getMarketData.return_value = {
            "status": status,
            "message": "" if status else "An invalid response was received from the upstream server",
            "data": {"fetched": rows},
        }
    return c


async def test_batch_uses_one_angel_call_for_many_tickers():
    """The whole point: N tickers must cost ONE upstream request, not N."""
    from app.services.market import get_prices_batch
    client = make_batch_client([
        {"symbolToken": "2885", "ltp": 2954.50},
        {"symbolToken": "1234", "ltp": 812.25},
    ])
    with patch("app.services.market.get_tokens_batch", new_callable=AsyncMock,
               return_value={"RELIANCE": "2885", "LAURUSLABS": "1234"}), \
         patch("app.services.market.angel_session") as sess:
        sess.client = AsyncMock(return_value=client)
        prices, errors = await get_prices_batch(["RELIANCE", "LAURUSLABS"])

    assert prices == {"RELIANCE": 2954.50, "LAURUSLABS": 812.25}
    assert errors == {}
    assert client.getMarketData.call_count == 1


async def test_batch_gateway_failure_reports_reason_for_every_ticker():
    """A 502-style status:false must be retried, then reported per ticker —
    this is the 'invalid response from upstream server' outage."""
    from app.services.market import get_prices_batch
    client = make_batch_client([], status=False)
    with patch("app.services.market.get_tokens_batch", new_callable=AsyncMock,
               return_value={"ADANIENSOL": "111", "POWERINDIA": "222"}), \
         patch("app.services.market.angel_session") as sess, \
         patch("app.services.market._RETRY_DELAY_S", 0):
        sess.client = AsyncMock(return_value=client)
        prices, errors = await get_prices_batch(["ADANIENSOL", "POWERINDIA"])

    assert prices == {}
    assert "upstream server" in errors["ADANIENSOL"]
    assert "upstream server" in errors["POWERINDIA"]
    # transient gateway errors are retried, unlike a deterministic bad symbol
    assert client.getMarketData.call_count == 2


async def test_batch_reports_ticker_missing_from_response():
    from app.services.market import get_prices_batch
    client = make_batch_client([{"symbolToken": "2885", "ltp": 2954.50}])
    with patch("app.services.market.get_tokens_batch", new_callable=AsyncMock,
               return_value={"RELIANCE": "2885", "BHARATFORG": "999"}), \
         patch("app.services.market.angel_session") as sess:
        sess.client = AsyncMock(return_value=client)
        prices, errors = await get_prices_batch(["RELIANCE", "BHARATFORG"])

    assert prices == {"RELIANCE": 2954.50}
    assert "missing from batch quote response" in errors["BHARATFORG"]


async def test_batch_flags_unknown_symbol_without_calling_angel():
    """A symbol genuinely absent from a LOADED master.

    instruments_ready is patched true on purpose: the same empty token_map
    means something completely different when the master has not loaded yet,
    and that case is covered by test_a_slow_token_load_cannot_eat_the_deadline.
    """
    from app.services.market import get_prices_batch
    client = make_batch_client([])
    with patch("app.services.market.get_tokens_batch", new_callable=AsyncMock,
               return_value={}), \
         patch("app.services.market.instruments_ready", lambda: True), \
         patch("app.services.market.angel_session") as sess:
        sess.client = AsyncMock(return_value=client)
        prices, errors = await get_prices_batch(["NOSUCHTICKER"])

    assert prices == {}
    assert errors["NOSUCHTICKER"] == "Symbol not found in instruments master"
    client.getMarketData.assert_not_called()


async def test_batch_serves_cache_without_hitting_angel():
    from app.services.market import get_prices_batch
    client = make_batch_client([{"symbolToken": "2885", "ltp": 2954.50}])
    with patch("app.services.market.get_tokens_batch", new_callable=AsyncMock,
               return_value={"RELIANCE": "2885"}), \
         patch("app.services.market.angel_session") as sess:
        sess.client = AsyncMock(return_value=client)
        await get_prices_batch(["RELIANCE"])
        prices, _ = await get_prices_batch(["RELIANCE"])   # within 3s TTL

    assert prices == {"RELIANCE": 2954.50}
    assert client.getMarketData.call_count == 1


# ── timeout budget (the bug that caused the 14 Sep outage) ───────────────────

async def test_no_stage_can_outlive_the_deadline_however_it_is_configured():
    """The test that does not depend on me remembering the stages.

    Four times a stage overran the deadline while a budget test stayed green,
    because that test could only add up the awaits I had thought to put in it:

        60s instruments load  vs a 45s caller
        20.5s quote           vs a 20s client budget
        20s Angel login       vs a 16s deadline
        25s instruments load  vs an 18s deadline

    So this asserts the property instead of the arithmetic. Every timeout on
    the path is set hostile — far larger than the deadline — and the batch
    must STILL come back inside it. Adding a new stage that ignores the
    deadline fails this without anyone having to update a sum.
    """
    from app.services import market

    async def _never_returns(*a, **k):
        await asyncio.sleep(60)

    slow_session = AsyncMock()
    slow_session.client = _never_returns

    with patch.object(market, "_BATCH_TIMEOUT_S", 999.0), \
         patch.object(market, "_SESSION_WAIT_S", 999.0), \
         patch.object(market, "_TOKEN_WAIT_S", 999.0), \
         patch.object(market, "_RETRY_DELAY_S", 999.0), \
         patch.object(market, "angel_session", slow_session), \
         patch.object(market, "get_tokens_batch", AsyncMock(return_value={"X": "1"})), \
         patch.object(market, "instruments_ready", lambda: True):
        started = time.monotonic()
        prices, errors = await market.get_prices_batch(["X"], budget_s=1.0)
        elapsed = time.monotonic() - started

    assert elapsed < 3.0, (
        f"batch took {elapsed:.1f}s against a 1.0s budget — a stage is not "
        f"honouring the deadline"
    )
    assert prices == {}
    assert "X" in errors


async def test_a_slow_token_load_cannot_eat_the_deadline():
    """The 15 Sep failure: a cold instruments load on the price path.

    A deploy replaces the machine, so the /tmp snapshot is gone and the first
    poll triggers a full scrip-master download bounded at 25s — on an 18s
    deadline, inside no timeout at all. Every poll after a deploy therefore
    exceeded the deadline and reported "Upstream quote exceeded the 18s
    server deadline" for every ticker at once.
    """
    from app.services import market

    async def _slow_tokens(symbols, max_wait=None):
        # Honours max_wait the way the real one does: bounded wait, and the
        # download survives it.
        await asyncio.sleep(min(max_wait if max_wait is not None else 30, 30))
        return {}

    with patch.object(market, "get_tokens_batch", _slow_tokens), \
         patch.object(market, "_TOKEN_WAIT_S", 0.2), \
         patch.object(market, "instruments_ready", lambda: False):
        started = time.monotonic()
        prices, errors = await market.get_prices_batch(["ADANIENSOL"], budget_s=5.0)
        elapsed = time.monotonic() - started

    assert elapsed < 2.0, f"token stage ran {elapsed:.1f}s, ignoring its cap"
    # And it must say it was still loading, not that the ticker is unknown.
    assert "Instruments master unavailable" in errors["ADANIENSOL"], errors


def test_the_token_wait_is_smaller_than_the_load_it_waits_on():
    """Sanity on the two constants, stated where both are visible.

    _LOAD_TIMEOUT_S is deliberately LONGER than the caller's wait — the load
    is a background task that outlives any one request. That is only safe
    because the caller no longer owns it; if a caller awaited the load
    directly, a 30s poll would cancel and restart it forever.
    """
    from app.services import market
    from app.services import instruments

    assert market._TOKEN_WAIT_S < market.BATCH_DEADLINE_S
    assert market._TOKEN_WAIT_S < instruments._LOAD_TIMEOUT_S


def test_the_deadline_still_lands_before_the_client_gives_up():
    """Answering with a reason beats being cut off carrying none."""
    from app.services import market

    assert market.BATCH_DEADLINE_S < market.CLIENT_BUDGET_S, (
        f"server deadline {market.BATCH_DEADLINE_S}s must land before the "
        f"client gives up at {market.CLIENT_BUDGET_S}s, or the client learns "
        f"nothing about why"
    )


async def test_multi_price_answers_with_a_reason_instead_of_hanging():
    """Being cut off tells the caller nothing. Exceeding the deadline must
    still produce a per-ticker reason."""
    from app.services import market

    async def _hang(_tickers):
        await asyncio.sleep(5)

    with patch("app.routers.market.get_prices_batch", side_effect=_hang), \
         patch("app.routers.market.BATCH_DEADLINE_S", 0.05):
        from httpx import ASGITransport, AsyncClient
        from app.main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/market/multi-price?tickers=ADANIENSOL,LAURUSLABS")

    assert resp.status_code == 200
    prices = resp.json()["prices"]
    assert set(prices) == {"ADANIENSOL", "LAURUSLABS"}
    for row in prices.values():
        assert row["price"] is None
        assert "server deadline" in row["error"]


# ── server-side stage timing ─────────────────────────────────────────────────

async def test_batch_records_where_the_time_went():
    """Client-side timing can only say the call took 20s. It cannot say which
    stage consumed it, and guessing that from outside has been wrong
    repeatedly — so the server records its own split."""
    from app.services import market

    market._recent_timings.clear()
    client = make_batch_client([{"symbolToken": "2885", "ltp": 2954.50}])
    with patch("app.services.market.get_tokens_batch", new_callable=AsyncMock,
               return_value={"RELIANCE": "2885"}), \
         patch("app.services.market.angel_session") as sess:
        sess.client = AsyncMock(return_value=client)
        await market.get_prices_batch(["RELIANCE"])

    recorded = market.recent_price_timings()
    assert len(recorded) == 1
    entry = recorded[0]
    assert entry["tickers"] == 1
    assert entry["priced"] == 1
    assert entry["failed"] == 0
    # The split must add up, so the alert can name the slow stage.
    assert entry["tokens_s"] + entry["quote_s"] == pytest.approx(entry["total_s"], abs=0.05)
    assert "at" in entry


async def test_health_exposes_the_timings(client):
    """The bot probes /health on a price failure, so the split has to ride
    out on that response."""
    from app.services import market

    market._recent_timings.clear()
    market.record_price_timing(tickers=4, tokens_s=0.01, quote_s=14.4,
                               total_s=14.41, priced=0, failed=4)

    resp = await client.get("/health")
    assert resp.status_code == 200
    timings = resp.json()["recent_price_timings"]
    assert timings[0]["quote_s"] == 14.4
    assert timings[0]["failed"] == 4


def test_only_the_most_recent_requests_are_kept():
    """A ring buffer — this is diagnostics, not a metrics store."""
    from app.services import market

    market._recent_timings.clear()
    for i in range(12):
        market.record_price_timing(tickers=i, total_s=float(i))
    kept = market.recent_price_timings()
    assert len(kept) == 5
    assert kept[0]["tickers"] == 11   # newest first


def test_a_login_can_never_outlast_the_endpoint_budget():
    """Obtaining the session may trigger a login bounded at _LOGIN_TIMEOUT_S.
    A price request must not be able to wait that long: 20s against an 18s
    deadline is what produced "Upstream quote exceeded the server deadline"
    while the app was perfectly healthy."""
    from app.services import market
    from app.services import angel_client

    assert market._SESSION_WAIT_S < market.BATCH_DEADLINE_S
    assert market._SESSION_WAIT_S < angel_client._LOGIN_TIMEOUT_S, (
        "the price path should give up well before the login does — the "
        "background warmup owns the login, not the poll"
    )


async def test_session_not_ready_fails_fast_with_a_clear_reason():
    """Rather than waiting out a login and blowing the budget, the poll says
    what happened and lets the next one (30s later) find the session."""
    from app.services import market

    async def _slow_session():
        await asyncio.sleep(5)

    with patch("app.services.market.get_tokens_batch", new_callable=AsyncMock,
               return_value={"RELIANCE": "2885"}), \
         patch("app.services.market.angel_session") as sess, \
         patch("app.services.market._SESSION_WAIT_S", 0.05), \
         patch("app.services.market._RETRY_DELAY_S", 0):
        sess.client = _slow_session
        prices, errors = await market.get_prices_batch(["RELIANCE"])

    assert prices == {}
    assert "session not ready" in errors["RELIANCE"]
