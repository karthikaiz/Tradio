import logging
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock
from app.services.market import get_price, get_cache_info, clear_cache, MarketDataError

logger = logging.getLogger(__name__)


@pytest.fixture(autouse=True)
def reset_cache():
    """Clear the price cache before every test."""
    clear_cache()
    yield
    clear_cache()


def make_mock_ticker(current_price=None, history_close=None, raise_exc=None):
    """Helper to build a mock yfinance Ticker."""
    mock_ticker = MagicMock()

    if raise_exc:
        mock_ticker.info = MagicMock(side_effect=raise_exc)
    else:
        info = {}
        if current_price is not None:
            info["currentPrice"] = current_price
        mock_ticker.info = info

    if history_close is not None:
        import pandas as pd
        hist = pd.DataFrame({"Close": [history_close]})
        mock_ticker.history.return_value = hist
    else:
        mock_ticker.history.return_value = MagicMock(empty=True)

    return mock_ticker


async def test_get_price_returns_current_price():
    mock_ticker = make_mock_ticker(current_price=2954.50)
    with patch("app.services.market.yf") as mock_yf:
        mock_yf.Ticker.return_value = mock_ticker
        price = await get_price("RELIANCE")

    assert price == 2954.50
    logger.info("Verified: get_price returns currentPrice from yfinance info")


async def test_ns_suffix_appended():
    mock_ticker = make_mock_ticker(current_price=3500.00)
    with patch("app.services.market.yf") as mock_yf:
        mock_yf.Ticker.return_value = mock_ticker
        await get_price("TCS")

    mock_yf.Ticker.assert_called_once_with("TCS.NS")
    logger.info("Verified: yfinance is called with 'TCS.NS' not 'TCS'")


async def test_get_price_fallback_to_history():
    mock_ticker = make_mock_ticker(history_close=1580.25)
    # No currentPrice in info
    mock_ticker.info = {}
    import pandas as pd
    mock_ticker.history.return_value = pd.DataFrame({"Close": [1580.25]})

    with patch("app.services.market.yf") as mock_yf:
        mock_yf.Ticker.return_value = mock_ticker
        price = await get_price("INFY")

    assert price == 1580.25
    logger.info("Verified: get_price falls back to history close price when currentPrice missing")


async def test_get_price_caches_result():
    mock_ticker = make_mock_ticker(current_price=2900.00)
    with patch("app.services.market.yf") as mock_yf:
        mock_yf.Ticker.return_value = mock_ticker
        price1 = await get_price("RELIANCE")
        price2 = await get_price("RELIANCE")  # second call — should use cache

    assert price1 == price2 == 2900.00
    assert mock_yf.Ticker.call_count == 1  # yfinance called only once
    logger.info("Verified: second call within 60s returns cached price, yfinance called only once")


async def test_get_price_cache_expires():
    mock_ticker = make_mock_ticker(current_price=2900.00)
    with patch("app.services.market.yf") as mock_yf:
        mock_yf.Ticker.return_value = mock_ticker
        await get_price("RELIANCE")

        # Manually expire the cache entry
        from app.services import market as market_module
        ticker, (price, fetched_at) = list(market_module._cache.items())[0]
        market_module._cache[ticker] = (price, fetched_at - timedelta(seconds=61))

        await get_price("RELIANCE")  # should re-fetch

    assert mock_yf.Ticker.call_count == 2
    logger.info("Verified: cache entry older than 60s triggers a fresh yfinance fetch")


async def test_get_price_raises_market_data_error_on_exception():
    with patch("app.services.market.yf") as mock_yf:
        mock_yf.Ticker.side_effect = Exception("Connection timeout")
        with pytest.raises(MarketDataError) as exc_info:
            await get_price("RELIANCE")

    assert exc_info.value.ticker == "RELIANCE"
    logger.info("Verified: yfinance exception raises MarketDataError with correct ticker")


async def test_get_price_raises_market_data_error_on_empty_data():
    mock_ticker = MagicMock()
    mock_ticker.info = {}  # no currentPrice
    import pandas as pd
    mock_ticker.history.return_value = pd.DataFrame()  # empty history

    with patch("app.services.market.yf") as mock_yf:
        mock_yf.Ticker.return_value = mock_ticker
        with pytest.raises(MarketDataError):
            await get_price("BADTICKER")

    logger.info("Verified: empty price data raises MarketDataError — never returns 0 or None")


async def test_market_price_endpoint_200(client):
    mock_ticker = make_mock_ticker(current_price=2954.50)
    with patch("app.services.market.yf") as mock_yf:
        mock_yf.Ticker.return_value = mock_ticker
        response = await client.get("/api/market/price?ticker=RELIANCE")

    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "RELIANCE"
    assert data["price"] == 2954.50
    assert "cached" in data
    assert "as_of" in data
    logger.info("Verified: GET /api/market/price returns 200 with ticker, price, cached, as_of")


async def test_market_price_endpoint_503_on_error(client):
    with patch("app.services.market.yf") as mock_yf:
        mock_yf.Ticker.side_effect = Exception("Yahoo Finance blocked")
        response = await client.get("/api/market/price?ticker=RELIANCE")

    assert response.status_code == 503
    data = response.json()
    assert data["detail"]["error"] == "Market data unavailable"
    assert data["detail"]["ticker"] == "RELIANCE"
    logger.info("Verified: GET /api/market/price returns 503 when yfinance fails")
