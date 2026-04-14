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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, body?.detail ?? body);
  }

  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MarketPrice {
  ticker: string;
  price: number;
  cached: boolean;
  as_of: string;
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

// ── API Functions ─────────────────────────────────────────────────────────────

export const api = {
  getPrice: (ticker: string) =>
    request<MarketPrice>(`/api/market/price?ticker=${encodeURIComponent(ticker)}`),

  buy: (ticker: string, quantity: number) =>
    request<TradeResult>("/api/trade/buy", {
      method: "POST",
      body: JSON.stringify({ ticker, quantity }),
    }),

  sell: (ticker: string, quantity: number) =>
    request<TradeResult>("/api/trade/sell", {
      method: "POST",
      body: JSON.stringify({ ticker, quantity }),
    }),

  getPortfolio: () => request<Portfolio>("/api/portfolio"),

  getOrders: (limit = 50, offset = 0) =>
    request<OrderRecord[]>(`/api/orders?limit=${limit}&offset=${offset}`),
};
