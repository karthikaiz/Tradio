import asyncio
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
    from app.services.market import get_prices_batch
    client = make_batch_client([])
    with patch("app.services.market.get_tokens_batch", new_callable=AsyncMock,
               return_value={}), \
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

def test_server_worst_case_fits_inside_the_client_budget():
    """The failure this encodes, verbatim from the alert:

        GET /api/market/multi-price (timeout=20s) failed after 20.0s

    _BATCH_TIMEOUT_S was 10s with 2 attempts and a 0.5s delay = 20.5s worst
    case, against a 20.0s client budget. The client therefore abandoned the
    request half a second before the server could possibly answer — every
    time Angel was slow enough to burn both attempts. Not intermittent: a
    certainty, by arithmetic.

    The same shape had already been fixed once in instruments.py (60s load
    vs a 45s caller) and was then recreated here, so it is asserted rather
    than left to review.
    """
    from app.services import market

    worst = market._worst_case_fetch_s()
    assert worst < market.BATCH_DEADLINE_S, (
        f"one chunk can take {worst}s but the endpoint cuts off at "
        f"{market.BATCH_DEADLINE_S}s"
    )
    assert market.BATCH_DEADLINE_S < market.CLIENT_BUDGET_S, (
        f"server deadline {market.BATCH_DEADLINE_S}s must land before the "
        f"client gives up at {market.CLIENT_BUDGET_S}s, or the client learns "
        f"nothing about why"
    )


def test_single_ticker_path_also_fits_the_budget():
    """get_price backs /api/market/price and the order path; it retries too."""
    from app.services import market

    worst = market._worst_case_fetch_s(per_attempt=8.0)   # get_price's timeout
    assert worst < market.CLIENT_BUDGET_S


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
