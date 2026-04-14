from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import market, trade, portfolio, orders

app = FastAPI(title="Tradio API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market.router)
app.include_router(trade.router)
app.include_router(portfolio.router)
app.include_router(orders.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
