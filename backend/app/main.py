from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import market, trade, portfolio, orders, leaderboard, watchlist, user, challenges
import os

app = FastAPI(title="Tradio API", version="1.0.0")

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
app.include_router(leaderboard.router)
app.include_router(watchlist.router)
app.include_router(user.router)
app.include_router(challenges.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
