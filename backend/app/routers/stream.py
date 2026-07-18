import asyncio
import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.services.angel_client import angel_session
from app.services.price_stream import price_stream

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stream")


@router.get("/health")
async def stream_health():
    """Read-only Angel WS feed health: connection state, last tick age,
    last error, restart count. Contains no credentials."""
    return price_stream.health()


@router.get("/prices")
async def stream_prices(tickers: str):
    """SSE endpoint — streams real-time price ticks for the requested tickers.

    Connect with EventSource directly to the backend URL (not through Next.js
    proxy) to avoid response buffering:

        new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/api/stream/prices?tickers=RELIANCE,TCS`)
    """
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return StreamingResponse(iter([]), media_type="text/event-stream")

    ticker_set = set(ticker_list)

    client = await angel_session.client()
    await price_stream.ensure_started(client)
    await price_stream.add_tickers(ticker_list)

    async def event_generator():
        q: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        price_stream.add_subscriber(q, loop)

        # Flush any already-cached prices immediately
        current = price_stream.get_current(ticker_list)
        if current:
            yield f"data: {json.dumps({'prices': current})}\n\n"

        try:
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25)
                    if data["ticker"] in ticker_set:
                        yield f"data: {json.dumps(data)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"  # keep proxy/load-balancer from timing out
        except (GeneratorExit, asyncio.CancelledError):
            pass
        finally:
            price_stream.remove_subscriber(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
            "Connection": "keep-alive",
        },
    )
