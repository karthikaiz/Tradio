const BASE_URL = "";

export class ApiError extends Error {
  status: number;
  detail: Record<string, unknown>;

  constructor(status: number, detail: Record<string, unknown>) {
    const message =
      typeof detail === "object" && detail?.error
        ? String(detail.error)
        : "An error occurred";
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, options?: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, body?.detail ?? body);
  }

  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SearchResult {
  ticker: string;
  name: string;
  exchange: string;
}

export interface MarketPrice {
  ticker: string;
  price: number;
  cached: boolean;
  as_of: string;
}

export interface PriceEntry {
  price: number | null;
  as_of: string | null;
  error: string | null;
}

export interface MultiPriceResponse {
  prices: Record<string, PriceEntry>;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoryResponse {
  ticker: string;
  period: string;
  interval: string;
  candles: Candle[];
}

export interface Holding {
  ticker: string;
  quantity: number;
  avg_buy_price: number;
  current_price: number | null;
  invested_value: number;
  current_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
  error: string | null;
}

export interface Portfolio {
  available_balance: number;
  total_invested: number;
  total_current_value: number;
  total_unrealized_pnl: number;
  total_unrealized_pnl_pct: number;
  total_realized_pnl: number;
  holdings: Holding[];
}

export interface TradeResult {
  order_id: number;
  ticker: string;
  quantity: number;
  execution_price: number;
  total_cost?: number;
  proceeds?: number;
  realized_pnl?: number;
  new_balance: number;
}

export type TradeReason =
  | "MOMENTUM"
  | "NEWS"
  | "LONG_TERM"
  | "FRIEND_TIP"
  | "GUT_FEELING"
  | "CHART_PATTERN"
  | "SECTOR_TREND"
  | "CUSTOM";

export interface OrderRecord {
  order_id: number;
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  execution_price: number;
  realized_pnl: number | null;
  status: string;
  trade_reason: TradeReason | null;
  timestamp: string;
}

export interface CategoryStock {
  ticker: string;
  name: string;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
}

export interface MarketCategories {
  gainers: CategoryStock[];
  losers: CategoryStock[];
  active: CategoryStock[];
  stable: CategoryStock[];
}

export type UserGoal = "LEARN_BASICS" | "PRACTICE_STOCKS" | "DEVELOP_STRATEGY";

export interface UserProfile {
  username: string;
  goal: UserGoal | null;
}

export interface WatchlistResponse {
  tickers: string[];
}

export interface CoachHolding {
  ticker: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  current_price: number | null;
  invested_value: number;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
}

export interface CoachFeedbackRequest {
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  execution_price: number;
  trade_reason: TradeReason | null;
  custom_reason?: string | null;
  price_change_pct?: number | null;
  portfolio_context: {
    available_balance: number;
    total_invested: number;
    total_unrealized_pnl: number;
    total_unrealized_pnl_pct: number;
    holdings: CoachHolding[];
  };
}

export interface CoachFeedbackResponse {
  feedback: string;
  tone: "positive" | "warning" | "info";
}

export interface HealthScore {
  score: number;
  label: "NEW" | "LEARNING" | "DEVELOPING" | "CONSISTENT" | "DISCIPLINED";
  breakdown: {
    diversification: number;
    concentration: number;
    activity: number;
    discipline: number;
  };
}

// ── API Functions ─────────────────────────────────────────────────────────────

export const api = {
  // Public endpoints
  getPrice: (ticker: string, signal?: AbortSignal) =>
    request<MarketPrice>(`/api/market/price?ticker=${encodeURIComponent(ticker)}`, { signal }),

  getMultiPrice: (tickers: string[], signal?: AbortSignal) =>
    request<MultiPriceResponse>(
      `/api/market/multi-price?tickers=${encodeURIComponent(tickers.join(","))}`,
      { signal }
    ),

  getHistory: (ticker: string, period = "1d", signal?: AbortSignal) =>
    request<HistoryResponse>(
      `/api/market/history?ticker=${encodeURIComponent(ticker)}&period=${period}`,
      { signal }
    ),

  searchTickers: (q: string, signal?: AbortSignal) =>
    request<{ results: SearchResult[] }>(`/api/market/search?q=${encodeURIComponent(q)}`, { signal }),

  getCategories: (signal?: AbortSignal) =>
    request<MarketCategories>("/api/market/categories", { signal }),

  // Auth-required endpoints
  buy: (ticker: string, quantity: number, token: string, trade_reason?: TradeReason | null) =>
    request<TradeResult>("/api/trade/buy", {
      method: "POST",
      body: JSON.stringify({ ticker, quantity, trade_reason: trade_reason ?? null }),
    }, token),

  sell: (ticker: string, quantity: number, token: string, trade_reason?: TradeReason | null) =>
    request<TradeResult>("/api/trade/sell", {
      method: "POST",
      body: JSON.stringify({ ticker, quantity, trade_reason: trade_reason ?? null }),
    }, token),

  getPortfolio: (token: string) =>
    request<Portfolio>("/api/portfolio", undefined, token),

  getOrders: (token: string, limit = 50, offset = 0) =>
    request<OrderRecord[]>(`/api/orders?limit=${limit}&offset=${offset}`, undefined, token),

  getProfile: (token: string) =>
    request<UserProfile>("/api/user/profile", undefined, token),

  updateUsername: (username: string, token: string) =>
    request<UserProfile>("/api/user/username", {
      method: "PATCH",
      body: JSON.stringify({ username }),
    }, token),

  getWatchlist: (token: string) =>
    request<WatchlistResponse>("/api/watchlist", undefined, token),

  addToWatchlist: (ticker: string, token: string) =>
    request<{ ticker: string }>("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ ticker }),
    }, token),

  removeFromWatchlist: (ticker: string, token: string) =>
    fetch(`/api/watchlist/${encodeURIComponent(ticker)}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    }).then((r) => { if (!r.ok && r.status !== 204) throw new Error("Failed to remove"); }),

  getCoachFeedback: (req: CoachFeedbackRequest, token: string) =>
    request<CoachFeedbackResponse>("/api/coach/feedback", {
      method: "POST",
      body: JSON.stringify(req),
    }, token),

  getHealthScore: (token: string) =>
    request<HealthScore>("/api/portfolio/health", undefined, token),

  setGoal: (goal: UserGoal, token: string) =>
    request<{ goal: UserGoal }>("/api/user/goal", {
      method: "PATCH",
      body: JSON.stringify({ goal }),
    }, token),

};
