import os
import asyncio
import time
import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from groq import AsyncGroq, APIStatusError
from app.auth import get_current_user_id

router = APIRouter(prefix="/api/coach", tags=["coach"])
logger = logging.getLogger(__name__)

SECTOR_MAP: dict[str, str] = {
    # IT
    "TCS": "IT", "INFY": "IT", "WIPRO": "IT", "HCLTECH": "IT", "TECHM": "IT",
    "LTIM": "IT", "MPHASIS": "IT", "COFORGE": "IT", "PERSISTENT": "IT",
    # Banking
    "HDFCBANK": "Banking", "ICICIBANK": "Banking", "SBIN": "Banking",
    "KOTAKBANK": "Banking", "AXISBANK": "Banking", "INDUSINDBK": "Banking",
    "IDFCFIRSTB": "Banking", "FEDERALBNK": "Banking", "BANDHANBNK": "Banking",
    "CANBK": "Banking", "BANKBARODA": "Banking", "UNIONBANK": "Banking", "PNB": "Banking",
    # Financial Services
    "BAJFINANCE": "Financial Services", "BAJAJFINSV": "Financial Services",
    "CHOLAFIN": "Financial Services", "MUTHOOTFIN": "Financial Services",
    "RECLTD": "Financial Services", "PFC": "Financial Services",
    "SBICARD": "Financial Services", "CAMS": "Financial Services",
    "HDFCLIFE": "Insurance", "SBILIFE": "Insurance", "ICICIPRULI": "Insurance",
    "ICICIGI": "Insurance", "HDFCAMC": "Asset Management",
    "NIPPONLIFE": "Asset Management", "ABSLAMC": "Asset Management",
    "POLICYBZR": "Fintech", "PAYTM": "Fintech",
    # FMCG
    "HINDUNILVR": "FMCG", "NESTLEIND": "FMCG", "ITC": "FMCG",
    "BRITANNIA": "FMCG", "DABUR": "FMCG", "MARICO": "FMCG",
    "GODREJCP": "FMCG", "COLPAL": "FMCG", "EMAMILTD": "FMCG", "TATACONSUM": "FMCG",
    # Auto
    "MARUTI": "Auto", "TATAMOTORS": "Auto", "M_M": "Auto",
    "BAJAJ_AUTO": "Auto", "HEROMOTOCO": "Auto", "EICHERMOT": "Auto",
    "MOTHERSON": "Auto Components", "BALKRISIND": "Auto Components",
    # Pharma / Healthcare
    "SUNPHARMA": "Pharma", "DRREDDY": "Pharma", "CIPLA": "Pharma",
    "DIVISLAB": "Pharma", "ZYDUSLIFE": "Pharma", "TORNTPHARM": "Pharma",
    "APOLLOHOSP": "Healthcare",
    # Metals & Mining
    "TATASTEEL": "Metals", "JSWSTEEL": "Metals", "HINDALCO": "Metals",
    "VEDL": "Metals", "COALINDIA": "Mining", "NMDC": "Mining",
    "JINDALSTEL": "Metals", "APLAPOLLO": "Metals",
    # Energy & Oil
    "RELIANCE": "Energy", "ONGC": "Oil & Gas", "BPCL": "Oil & Gas",
    "IOC": "Oil & Gas", "GAIL": "Oil & Gas", "PETRONET": "Oil & Gas",
    "IGL": "Gas Distribution", "MGL": "Gas Distribution", "GUJGASLTD": "Gas Distribution",
    # Power & Infrastructure
    "NTPC": "Power", "POWERGRID": "Power", "TATAPOWER": "Power",
    "LT": "Infrastructure", "ADANIPORTS": "Infrastructure",
    # Cement & Materials
    "ULTRACEMCO": "Cement", "GRASIM": "Cement & Materials",
    # Consumer Discretionary
    "TITAN": "Consumer Discretionary", "ASIANPAINT": "Paints",
    "PIDILITIND": "Specialty Chemicals", "HAVELLS": "Consumer Electronics",
    "DMART": "Retail", "TRENT": "Retail", "NYKAA": "E-Commerce",
    "ASTRAL": "Building Materials",
    # Food Tech
    "SWIGGY": "Food Tech", "ZOMATO": "Food Tech",
    # Telecom
    "BHARTIARTL": "Telecom",
    # Chemicals
    "ALKYLAMINE": "Chemicals",
    # Conglomerate
    "ADANIENT": "Conglomerate",
    # Travel
    "IRCTC": "Travel & Tourism",
}

SYSTEM_PROMPT = (
    "You are an AI trading coach for young Indian investors (ages 17-25) learning the stock market. "
    "You will receive the user's complete portfolio snapshot — all holdings with names, sectors, "
    "unrealised P&L, and cash position — followed by the new trade they just executed. "
    "Before responding, assess: sector concentration, biggest losses/wins, cash deployment, "
    "and whether the new trade adds risk or improves diversification. "
    "Then give exactly 2 sentences of specific, direct coaching that references actual holdings or sectors by name. "
    "Be honest — flag concentration, chasing (buying already-up stocks), gut-feel trades without rationale. "
    "Encourage discipline: logging reasons, spreading across sectors, not averaging down on losers without a thesis. "
    "Do not use bullet points. Do not add disclaimers. Do not repeat the trade details back. "
    "Address the trader directly. Indian equity market context (NSE/BSE)."
)

_stock_cache: dict[str, dict] = {}
_CACHE_TTL = 7 * 24 * 3600  # 1 week — sector/name rarely change

_price_cache: dict[str, dict] = {}
_PRICE_TTL = 3600  # 1 hour — price stats change throughout the day


async def _get_ticker_meta(ticker: str) -> dict[str, str]:
    """Returns {sector, name}. SECTOR_MAP for common stocks, yfinance + TTL cache for the rest."""
    if ticker in SECTOR_MAP:
        return {"sector": SECTOR_MAP[ticker], "name": ticker}

    cached = _stock_cache.get(ticker)
    if cached and time.time() - cached["ts"] < _CACHE_TTL:
        return cached

    try:
        import yfinance as yf
        loop = asyncio.get_running_loop()
        info = await loop.run_in_executor(None, lambda: yf.Ticker(f"{ticker}.NS").info)
        meta: dict = {
            "sector": info.get("sector") or "Other",
            "name": info.get("longName") or info.get("shortName") or ticker,
            "ts": time.time(),
        }
    except Exception:
        meta = {"sector": "Other", "name": ticker, "ts": time.time()}

    _stock_cache[ticker] = meta
    return meta


async def _get_price_stats(ticker: str) -> dict:
    """Returns day change %, 52-week range position, and volume ratio. Cached for 1 hour."""
    cached = _price_cache.get(ticker)
    if cached and time.time() - cached["ts"] < _PRICE_TTL:
        return cached

    try:
        import yfinance as yf
        loop = asyncio.get_running_loop()
        fi = await loop.run_in_executor(None, lambda: yf.Ticker(f"{ticker}.NS").fast_info)

        last_price = fi.last_price
        prev_close = fi.previous_close
        year_high = fi.year_high
        year_low = fi.year_low
        last_volume = fi.last_volume
        avg_volume = fi.three_month_average_volume

        day_change_pct = ((last_price - prev_close) / prev_close * 100) if prev_close else None
        range_span = (year_high - year_low) if year_high and year_low else 0
        range_pct = ((last_price - year_low) / range_span * 100) if range_span > 0 else None
        volume_ratio = (last_volume / avg_volume) if avg_volume and avg_volume > 0 else None

        stats: dict = {
            "day_change_pct": round(day_change_pct, 2) if day_change_pct is not None else None,
            "year_high": round(year_high, 2) if year_high else None,
            "year_low": round(year_low, 2) if year_low else None,
            "range_pct": round(range_pct, 0) if range_pct is not None else None,
            "volume_ratio": round(volume_ratio, 1) if volume_ratio is not None else None,
            "ts": time.time(),
        }
    except Exception:
        stats = {"day_change_pct": None, "year_high": None, "year_low": None, "range_pct": None, "volume_ratio": None, "ts": time.time()}

    _price_cache[ticker] = stats
    return stats


_fundamentals_cache: dict[str, dict] = {}
_FUNDAMENTALS_TTL = 24 * 3600  # 24 hours — earnings data changes quarterly


def _format_news_age(ts: int) -> str:
    diff = time.time() - ts
    if diff < 3600:
        return f"{int(diff/60)}m ago"
    if diff < 86400:
        return f"{int(diff/3600)}h ago"
    return f"{int(diff/86400)}d ago"


async def _get_fundamentals(ticker: str) -> dict:
    """Returns earnings growth, revenue growth, margins, P/E, and recent news. Cached 24h."""
    cached = _fundamentals_cache.get(ticker)
    if cached and time.time() - cached["ts"] < _FUNDAMENTALS_TTL:
        return cached

    try:
        import yfinance as yf
        loop = asyncio.get_running_loop()
        t = yf.Ticker(f"{ticker}.NS")

        info, raw_news = await asyncio.gather(
            loop.run_in_executor(None, lambda: t.info),
            loop.run_in_executor(None, lambda: t.news),
        )

        news = [
            {"title": n["title"], "age": _format_news_age(n.get("providerPublishTime", 0))}
            for n in (raw_news or [])[:5]
            if n.get("title")
        ]

        result: dict = {
            "eps_growth": info.get("earningsQuarterlyGrowth"),   # quarterly YoY
            "revenue_growth": info.get("revenueQuarterlyGrowth"),
            "profit_margin": info.get("profitMargins"),
            "roe": info.get("returnOnEquity"),
            "pe_ratio": info.get("trailingPE"),
            "debt_to_equity": info.get("debtToEquity"),
            "news": news,
            "ts": time.time(),
        }
    except Exception:
        result = {"news": [], "ts": time.time()}

    _fundamentals_cache[ticker] = result
    return result


WARNING_WORDS = {
    "careful", "risky", "risk", "high", "concentrated", "late", "overweight",
    "avoid", "weak", "volatile", "dangerous", "too much", "over", "watch",
    "concern", "heavy", "chasing", "fomo",
}
POSITIVE_WORDS = {
    "good", "well", "solid", "strong", "excellent", "nice", "great",
    "smart", "disciplined", "patient", "diversif", "sensible",
}


def _detect_tone(text: str) -> str:
    lower = text.lower()
    if any(w in lower for w in WARNING_WORDS):
        return "warning"
    if any(w in lower for w in POSITIVE_WORDS):
        return "positive"
    return "info"


def _trim_to_sentences(text: str, max_sentences: int = 2) -> str:
    import re
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(sentences[:max_sentences])


class HoldingContext(BaseModel):
    ticker: str
    name: str = ""
    quantity: int
    avg_buy_price: float
    current_price: float | None = None
    invested_value: float
    unrealized_pnl: float | None = None
    unrealized_pnl_pct: float | None = None


class PortfolioContext(BaseModel):
    available_balance: float
    total_invested: float
    total_unrealized_pnl: float
    total_unrealized_pnl_pct: float
    holdings: list[HoldingContext]


class CoachRequest(BaseModel):
    ticker: str
    side: str
    quantity: int
    execution_price: float
    trade_reason: str | None = None
    custom_reason: str | None = None
    price_change_pct: float | None = None
    portfolio_context: PortfolioContext


class CoachResponse(BaseModel):
    feedback: str
    tone: str


@router.post("/feedback", response_model=CoachResponse)
async def get_feedback(
    req: CoachRequest,
    _user_id: int = Depends(get_current_user_id),
):
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return CoachResponse(
            feedback="Add a GROQ_API_KEY to enable AI coaching feedback.",
            tone="info",
        )

    ctx = req.portfolio_context

    # Fetch all enrichment data in parallel
    unique_tickers = list({h.ticker for h in ctx.holdings} | {req.ticker})
    metas, price_stats, fundamentals = await asyncio.gather(
        asyncio.gather(*[_get_ticker_meta(t) for t in unique_tickers]),
        _get_price_stats(req.ticker),
        _get_fundamentals(req.ticker),
    )
    ticker_meta = dict(zip(unique_tickers, metas))

    # Build holdings lines
    holdings_lines = []
    sector_invested: dict[str, float] = {}
    for h in ctx.holdings:
        meta = ticker_meta[h.ticker]
        sector = meta["sector"]
        sector_invested[sector] = sector_invested.get(sector, 0) + h.invested_value
        display_name = h.name if h.name and h.name != h.ticker else meta["name"]
        name_label = f"{display_name} ({h.ticker})" if display_name != h.ticker else h.ticker
        pnl_str = f"P&L: ₹{h.unrealized_pnl:+.0f} ({h.unrealized_pnl_pct:+.1f}%)" if h.unrealized_pnl is not None else "P&L: n/a"
        holdings_lines.append(
            f"  • {name_label} — {sector} | {h.quantity} shares @ ₹{h.avg_buy_price:.2f} avg | {pnl_str}"
        )

    # Sector breakdown sorted by weight
    if ctx.total_invested > 0:
        sector_breakdown = ", ".join(
            f"{sec} {pct:.0f}%"
            for sec, pct in sorted(
                ((s, v / ctx.total_invested * 100) for s, v in sector_invested.items()),
                key=lambda x: -x[1],
            )
        )
    else:
        sector_breakdown = "no holdings yet"

    # Trade details
    if req.custom_reason:
        reason_text = req.custom_reason
    elif req.trade_reason and req.trade_reason != "CUSTOM":
        reason_text = req.trade_reason.replace("_", " ").title()
    else:
        reason_text = "No reason logged"
    traded_meta = ticker_meta[req.ticker]
    traded_name = traded_meta["name"] if traded_meta["name"] != req.ticker else req.ticker
    trade_label = f"{traded_name} ({req.ticker})" if traded_name != req.ticker else req.ticker

    # Determine exit type for SELL trades
    exit_label = ""
    if req.side == "SELL":
        current_holding = next((h for h in ctx.holdings if h.ticker == req.ticker), None)
        if current_holding:
            if req.quantity >= current_holding.quantity:
                exit_label = " — FULL EXIT (closing entire position)"
            else:
                remaining = current_holding.quantity - req.quantity
                exit_label = f" — PARTIAL EXIT (selling {req.quantity} of {current_holding.quantity} shares, {remaining} remaining)"

    # Price stat lines for traded stock
    ps = price_stats
    stat_parts = []
    if ps.get("day_change_pct") is not None:
        stat_parts.append(f"Today: {ps['day_change_pct']:+.1f}%")
    if ps.get("year_high") is not None and ps.get("year_low") is not None:
        pos_label = ""
        if ps.get("range_pct") is not None:
            rp = ps["range_pct"]
            if rp >= 90:
                pos_label = " — near 52w HIGH"
            elif rp <= 10:
                pos_label = " — near 52w LOW"
        stat_parts.append(f"52w range: ₹{ps['year_low']:,.0f}–₹{ps['year_high']:,.0f} ({ps['range_pct']:.0f}th percentile{pos_label})")
    if ps.get("volume_ratio") is not None:
        vr = ps["volume_ratio"]
        vol_label = " (unusually high)" if vr >= 2.0 else " (unusually low)" if vr <= 0.3 else ""
        stat_parts.append(f"Volume: {vr:.1f}x 3-month avg{vol_label}")
    price_stats_line = "\n  " + " | ".join(stat_parts) if stat_parts else ""

    # Fundamentals section for traded stock
    fd = fundamentals
    fund_parts = []
    if fd.get("eps_growth") is not None:
        fund_parts.append(f"Quarterly EPS growth (YoY): {fd['eps_growth']*100:+.1f}%")
    if fd.get("revenue_growth") is not None:
        fund_parts.append(f"Revenue growth (YoY): {fd['revenue_growth']*100:+.1f}%")
    if fd.get("profit_margin") is not None:
        fund_parts.append(f"Net profit margin: {fd['profit_margin']*100:.1f}%")
    if fd.get("pe_ratio") is not None:
        fund_parts.append(f"P/E: {fd['pe_ratio']:.1f}x")
    if fd.get("roe") is not None:
        fund_parts.append(f"ROE: {fd['roe']*100:.1f}%")
    if fd.get("debt_to_equity") is not None:
        fund_parts.append(f"Debt/Equity: {fd['debt_to_equity']:.2f}")

    fund_lines = []
    if fund_parts:
        fund_lines.append("  " + " | ".join(fund_parts))
    if fd.get("news"):
        fund_lines.append("  Recent news:")
        for n in fd["news"][:3]:
            fund_lines.append(f'    - "{n["title"]}" ({n["age"]})')

    fundamentals_section = (
        f"\nFUNDAMENTALS ({req.ticker}):\n" + "\n".join(fund_lines) + "\n"
        if fund_lines else ""
    )

    user_message = (
        f"PORTFOLIO SNAPSHOT:\n"
        f"  Cash: ₹{ctx.available_balance:,.0f} | Invested: ₹{ctx.total_invested:,.0f} | "
        f"Overall P&L: ₹{ctx.total_unrealized_pnl:+,.0f} ({ctx.total_unrealized_pnl_pct:+.2f}%)\n\n"
        f"HOLDINGS ({len(ctx.holdings)} position{'s' if len(ctx.holdings) != 1 else ''}):\n"
        + ("\n".join(holdings_lines) if holdings_lines else "  No current holdings.")
        + f"\n\nSECTOR BREAKDOWN: {sector_breakdown}\n"
        + fundamentals_section
        + f"\nNEW TRADE: {req.side} {req.quantity} shares of {trade_label} ({traded_meta['sector']}) at ₹{req.execution_price:.2f}{exit_label}\n"
        f"  Reason: {reason_text}{price_stats_line}\n\n"
        f"Assess the full portfolio context, fundamentals, and price data, then give specific feedback on this trade."
    )

    try:
        client = AsyncGroq(api_key=api_key)
        response = await client.chat.completions.create(
            model="qwen/qwen3-32b",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            reasoning_effort="none",
            max_completion_tokens=180,
            temperature=0.4,
        )
        raw = response.choices[0].message.content or ""
        feedback = _trim_to_sentences(raw.strip())
        logger.info(f"Coach feedback for {req.side} {req.ticker}: {feedback[:60]}...")
        return CoachResponse(feedback=feedback, tone=_detect_tone(feedback))

    except APIStatusError as e:
        logger.warning(f"Groq API error: {e.status_code} — {e.message}")
        raise HTTPException(status_code=502, detail={"error": "Coach unavailable", "reason": e.message})
    except Exception as e:
        logger.warning(f"Coach error: {e}")
        raise HTTPException(status_code=502, detail={"error": "Coach unavailable"})
