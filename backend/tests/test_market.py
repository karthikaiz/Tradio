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
         patch("app.services.market.angel_session") as mock_session:
        mock_session.client = AsyncMock(return_value=mock_client)
        with pytest.raises(MarketDataError) as exc_info:
            await get_price("RELIANCE")

    assert exc_info.value.ticker == "RELIANCE"
    logger.info("Verified: SmartAPI exception raises MarketDataError with correct ticker")


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
