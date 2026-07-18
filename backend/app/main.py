import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.log_redaction import install_redaction
from app.routers import market, trade, portfolio, orders, watchlist, user, coach, stream, bot

# Scrub broker credentials (password/TOTP/tokens) from ALL log records,
# including third-party library loggers — must run before any broker call
install_redaction()

logger = logging.getLogger(__name__)

app = FastAPI(title="Tradio API", version="1.0.0")


@app.on_event("startup")
async def _warm_angel_session():
    """Pre-login to Angel One at startup so the first /api/portfolio request
    doesn't block for ~16s waiting for session initialisation."""
    try:
        from app.services.angel_client import angel_session
        await angel_session.client()
        logger.info("Angel One session warmed up at startup")
    except Exception as e:
        logger.warning("Angel One warmup failed (non-fatal): %s", e)

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
    return {"status": "ok"}
