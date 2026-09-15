import asyncio
import logging
import os
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.log_redaction import install_redaction
from app.routers import market, trade, portfolio, orders, watchlist, user, coach, stream, bot

# Scrub broker credentials (password/TOTP/tokens) from ALL log records,
# including third-party library loggers — must run before any broker call
install_redaction()

logger = logging.getLogger(__name__)

# Matches [[vm]] memory in fly.toml — used only for the /health reading.
MEMORY_LIMIT_MB = int(os.getenv("MEMORY_LIMIT_MB", "256"))

app = FastAPI(title="Tradio API", version="1.0.0")


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """Every unhandled 500 logs its full traceback and returns the exception
    type + message in the body — so AlgoBot's Telegram alerts show the actual
    cause instead of an opaque 'Server error 500'."""
    logger.error(
        "Unhandled error on %s %s\n%s",
        request.method, request.url.path,
        "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
    )
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
    )


async def _warm_angel_session_bg():
    try:
        from app.services.angel_client import angel_session
        await angel_session.client()
        logger.info("Angel One session warmed up in background")
    except Exception as e:
        logger.warning("Angel One warmup failed (non-fatal): %s", e)


@app.on_event("startup")
async def _warm_angel_session():
    """Warm the Angel session WITHOUT blocking the server from serving.

    This used to await the login here. A startup handler runs before uvicorn
    binds the port, so the process was unreachable until Angel answered — by
    its own estimate ~16s, and unbounded, because the login had no timeout.

    Fly begins health-checking at grace_period (15s) with a 5s timeout. A
    boot that spends longer than that inside the Angel login therefore fails
    its checks while still starting, Fly kills the machine, and the next boot
    does the same thing: a restart loop in which the app never finishes
    starting. From outside it looks like every price request timing out at
    once, with /health unreachable too — which is exactly the recurring
    "price feed stale" outage, and why fixes inside the app never helped.
    They were in a process that was not running.

    Liveness must not depend on a third party being reachable. The warmup is
    now a background task: the port binds immediately, /health answers, and
    the first price request pays for the session if the warmup has not landed.
    """
    asyncio.create_task(_warm_angel_session_bg())

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://192.168.1.8:3000",
    "http://100.109.108.72:3000",
]
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    ALLOWED_ORIGINS.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market.router)
app.include_router(trade.router)
app.include_router(portfolio.router)
app.include_router(orders.router)
app.include_router(watchlist.router)
app.include_router(user.router)
app.include_router(coach.router)
app.include_router(stream.router)
app.include_router(bot.router)


@app.get("/health")
async def health_check():
    """Liveness plus a memory reading.

    This machine has 256MB with 512MB of swap. Once resident memory passes
    the cap the kernel swaps, and swap on shared-cpu-1x is slow enough that
    ordinary requests blow past the caller's timeout — which reaches the bot
    as "price feed stale" on every ticker at once, with no hint that memory
    was the cause. Reporting RSS here turns the next such incident into a
    measurement instead of a guess.
    """
    mem: dict[str, float | bool | None] = {}
    try:
        # /proc/self/status is cheap and needs no third-party dependency.
        with open("/proc/self/status") as f:
            fields = dict(
                line.split(":", 1) for line in f if ":" in line
            )
        rss_mb = int(fields["VmRSS"].strip().split()[0]) / 1024
        swap_mb = int(fields.get("VmSwap", "0 kB").strip().split()[0]) / 1024
        mem = {
            "rss_mb": round(rss_mb, 1),
            "swap_mb": round(swap_mb, 1),
            "limit_mb": MEMORY_LIMIT_MB,
            "pct_of_limit": round(rss_mb / MEMORY_LIMIT_MB * 100, 1),
            # Swapping at all on this machine means requests are already
            # being served from disk-backed pages.
            "swapping": swap_mb > 1,
        }
    except Exception:
        mem = {"rss_mb": None}

    return {"status": "ok", "memory": mem}
