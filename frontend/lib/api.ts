const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

export interface OrderRecord {
  order_id: number;
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  execution_price: number;
  realized_pnl: number | null;
  status: string;
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
  buy: (ticker: string, quantity: number, token: string) =>
    request<TradeResult>("/api/trade/buy", {
      method: "POST",
      body: JSON.stringify({ ticker, quantity }),
    }, token),

  sell: (ticker: string, quantity: number, token: string) =>
    request<TradeResult>("/api/trade/sell", {
      method: "POST",
      body: JSON.stringify({ ticker, quantity }),
    }, token),

  getPortfolio: (token: string) =>
    request<Portfolio>("/api/portfolio", undefined, token),

  getOrders: (token: string, limit = 50, offset = 0) =>
    request<OrderRecord[]>(`/api/orders?limit=${limit}&offset=${offset}`, undefined, token),
};
