"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTrading } from "@/lib/trading-context";
import { api, OrderRecord } from "@/lib/api";
import { useRouter } from "next/navigation";
import { getTickerName } from "@/lib/ticker-names";
import { motion, AnimatePresence } from "framer-motion";
import AnimatedNumber from "./ui/AnimatedNumber";
import PortfolioChart from "./PortfolioChart";

type Tab = "holdings" | "orders";

const fmtINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

const fmtINR0 = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

const sign = (v: number) => (v >= 0 ? "+" : "");

const TABS: { value: Tab; label: string }[] = [
  { value: "holdings", label: "HOLDINGS_" },
  { value: "orders",   label: "ORDERS_" },
];

export default function PortfolioPanel() {
  const { getToken } = useAuth();
  const { portfolio, portfolioLoading, refreshPortfolio } = useTrading();
  const [tab, setTab] = useState<Tab>("holdings");
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const router = useRouter();

  useEffect(() => { refreshPortfolio(); }, [refreshPortfolio]);

  // Fetch all orders on mount (used by chart + orders tab)
  useEffect(() => {
    setOrdersLoading(true);
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await api.getOrders(token, 500, 0);
        if (data) setOrders(data);
      } catch { /* ignore — chart shows empty state */ }
      finally { setOrdersLoading(false); }
    })();
  }, [getToken]);

  const thStyle: React.CSSProperties = {
    color: "var(--muted)",
    fontFamily: "var(--font-geist-mono)",
    fontSize: "10px",
    letterSpacing: "0.08em",
    fontWeight: 600,
  };

  const tdMono: React.CSSProperties = {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "12px",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary row */}
      {portfolio && (
        <div
          className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2.5 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          {[
            { label: "CASH LEFT", value: portfolio.available_balance, fmt: fmtINR0, color: "var(--text)" },
            { label: "INVESTED", value: portfolio.total_invested, fmt: fmtINR0, color: "var(--muted)" },
            {
              label: "PROFIT",
              value: portfolio.total_unrealized_pnl,
              fmt: (v: number) => `${sign(v)}${fmtINR0(v)}`,
              color: portfolio.total_unrealized_pnl >= 0 ? "var(--up)" : "var(--down)",
            },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)", fontSize: "9px", letterSpacing: "0.08em" }}>
                {item.label}
              </div>
              <AnimatedNumber
                value={item.value}
                format={item.fmt}
                className="font-bold"
                style={{ color: item.color, fontFamily: "var(--font-geist-mono)", fontSize: "15px" }}
              />
            </div>
          ))}
        </div>
      )}

      {/* P&L Chart */}
      <PortfolioChart orders={orders} portfolio={portfolio ?? null} />

      {/* Tabs */}
      <div className="flex border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className="px-4 py-2 text-xs relative transition-colors"
            style={{
              color: tab === t.value ? "var(--accent)" : "var(--muted)",
              fontFamily: "var(--font-geist-mono)",
              letterSpacing: "0.06em",
              borderBottom: tab === t.value ? "1px solid var(--accent)" : "1px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <AnimatePresence mode="wait">
          {tab === "holdings" && (
            <motion.div
              key="holdings"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {portfolioLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        className="w-1 h-4"
                        style={{ background: "var(--accent)" }}
                        animate={{ scaleY: [0.3, 1, 0.3] }}
                        transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }}
                      />
                    ))}
                  </div>
                </div>
              ) : !portfolio?.holdings.length ? (
                <div className="py-12 text-center">
                  <div className="text-xs font-mono mb-1" style={{ color: "var(--text-dim)", letterSpacing: "0.08em" }}>
                    NO_HOLDINGS
                  </div>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Place a buy order to get started.</p>
                </div>
              ) : (
                <table className="w-full" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "32%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "14%" }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--border)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 1 }}>
                      {["STOCK", "QTY", "AVG", "LTP", "P&L"].map((h) => (
                        <th key={h} className={`py-2 px-3 ${h === "STOCK" ? "text-left" : "text-right"}`} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.holdings.map((h, i) => {
                      const pnlColor = h.unrealized_pnl === null ? "var(--muted)"
                        : h.unrealized_pnl >= 0 ? "var(--up)" : "var(--down)";
                      return (
                        <motion.tr
                          key={h.ticker}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.2, delay: i * 0.03 }}
                          className="border-b cursor-pointer"
                          style={{ borderColor: "var(--border)" }}
                          onClick={() => router.push(`/stock/${h.ticker}`)}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                        >
                          <td className="py-3 px-3">
                            <div className="font-bold text-xs truncate" style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}>
                              {getTickerName(h.ticker) ?? h.ticker}
                            </div>
                            <div className="text-xs tracking-wider uppercase" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}>
                              {h.ticker}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right" style={{ ...tdMono, color: "var(--text)" }}>{h.quantity}</td>
                          <td className="py-3 px-3 text-right tabular" style={{ ...tdMono, color: "var(--muted)", fontSize: "11px" }}>
                            {fmtINR(h.avg_buy_price)}
                          </td>
                          <td className="py-3 px-3 text-right tabular" style={{ ...tdMono, color: "var(--text)", fontSize: "11px" }}>
                            {h.current_price !== null
                              ? <AnimatedNumber value={h.current_price} format={fmtINR} />
                              : <span style={{ color: "var(--muted)" }}>—</span>}
                          </td>
                          <td className="py-3 px-3 text-right tabular" style={{ fontSize: "11px" }}>
                            <div style={{ color: pnlColor, fontFamily: "var(--font-geist-mono)" }}>
                              {h.unrealized_pnl !== null ? `${sign(h.unrealized_pnl)}${fmtINR(h.unrealized_pnl)}` : "—"}
                            </div>
                            {h.unrealized_pnl_pct !== null && (
                              <div style={{ color: pnlColor, fontFamily: "var(--font-geist-mono)", fontSize: "10px", opacity: 0.8 }}>
                                {sign(h.unrealized_pnl_pct)}{h.unrealized_pnl_pct.toFixed(2)}%
                              </div>
                            )}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </motion.div>
          )}

          {tab === "orders" && (
            <motion.div
              key="orders"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {ordersLoading ? (
                <div className="py-12 text-center text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
                  LOADING...
                </div>
              ) : !orders.length ? (
                <div className="py-12 text-center">
                  <div className="text-xs font-mono mb-1" style={{ color: "var(--text-dim)", letterSpacing: "0.08em" }}>
                    NO_ORDERS
                  </div>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Your order history will appear here.</p>
                </div>
              ) : (
                <table className="w-full" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "38%" }} />
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "24%" }} />
                    <col style={{ width: "15%" }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--border)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 1 }}>
                      {["STOCK", "SIDE", "QTY", "PRICE", "P&L"].map((h) => (
                        <th key={h} className={`py-2 px-3 ${h === "STOCK" || h === "SIDE" ? "text-left" : "text-right"}`} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o, i) => {
                      const pnlColor = o.realized_pnl === null ? "var(--muted)"
                        : o.realized_pnl >= 0 ? "var(--up)" : "var(--down)";
                      const ts = new Date(o.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
                      return (
                        <motion.tr
                          key={o.order_id}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.2, delay: i * 0.02 }}
                          className="border-b"
                          style={{ borderColor: "var(--border)" }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                        >
                          <td className="py-3 px-3">
                            <div className="font-bold text-xs truncate" style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}>
                              {getTickerName(o.ticker) ?? o.ticker}
                            </div>
                            <div className="text-xs" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}>
                              {ts}
                            </div>
                            {o.trade_reason && (
                              <div className="text-xs mt-0.5" style={{ color: "var(--accent)", fontFamily: "var(--font-geist-mono)", fontSize: "9px", letterSpacing: "0.06em", opacity: 0.8 }}>
                                {o.trade_reason.replace(/_/g, " ")}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-left">
                            <span className="text-xs font-bold" style={{ color: o.side === "BUY" ? "var(--up)" : "var(--down)", fontFamily: "var(--font-geist-mono)" }}>
                              {o.side}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right tabular" style={{ ...tdMono, color: "var(--text)" }}>{o.quantity}</td>
                          <td className="py-3 px-3 text-right tabular" style={{ ...tdMono, color: "var(--text)", fontSize: "11px" }}>{fmtINR(o.execution_price)}</td>
                          <td className="py-3 px-3 text-right tabular" style={{ ...tdMono, color: pnlColor, fontSize: "11px" }}>
                            {o.realized_pnl !== null
                              ? `${sign(o.realized_pnl)}${fmtINR(o.realized_pnl)}`
                              : <span style={{ color: "var(--text-dim)", fontSize: "10px", fontFamily: "var(--font-geist-mono)" }}>
                                  {o.side === "BUY" ? "on sell" : "—"}
                                </span>
                            }
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
