"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTrading } from "@/lib/trading-context";
import { api, OrderRecord } from "@/lib/api";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import GlassCard from "./ui/GlassCard";
import AnimatedNumber from "./ui/AnimatedNumber";

type Tab = "holdings" | "orders";

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

const pnlSign = (v: number) => (v >= 0 ? "+" : "");

export default function PortfolioPanel() {
  const { getToken } = useAuth();
  const { portfolio, portfolioLoading, refreshPortfolio } = useTrading();
  const [tab, setTab] = useState<Tab>("holdings");
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    refreshPortfolio();
  }, [refreshPortfolio]);

  useEffect(() => {
    if (tab === "orders") {
      setOrdersLoading(true);
      getToken().then((token) => {
        if (!token) return;
        return api.getOrders(token, 50, 0);
      })
        .then((data) => { if (data) setOrders(data); })
        .finally(() => setOrdersLoading(false));
    }
  }, [tab, getToken]);

  const summaryCards = portfolio
    ? [
        {
          label: "Balance",
          value: portfolio.available_balance,
          format: formatINR,
          color: "var(--text)",
        },
        {
          label: "Invested",
          value: portfolio.total_invested,
          format: formatINR,
          color: "var(--text)",
        },
        {
          label: "Unrealized P&L",
          value: portfolio.total_unrealized_pnl,
          format: (v: number) => `${pnlSign(v)}${formatINR(v)}`,
          color: portfolio.total_unrealized_pnl >= 0 ? "var(--up)" : "var(--down)",
        },
        {
          label: "Realized P&L",
          value: portfolio.total_realized_pnl,
          format: (v: number) => `${pnlSign(v)}${formatINR(v)}`,
          color: portfolio.total_realized_pnl >= 0 ? "var(--up)" : "var(--down)",
        },
      ]
    : null;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--surface)",
        backdropFilter: "blur(var(--glass-blur))",
        WebkitBackdropFilter: "blur(var(--glass-blur))",
        border: "1px solid var(--border)",
      }}
    >
      {/* Summary cards */}
      {summaryCards && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: "var(--border)" }}>
          {summaryCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.06 }}
              className="px-4 py-3"
              style={{
                background: "var(--surface)",
                ...(i === 2 || i === 3
                  ? {
                      background:
                        (i === 2
                          ? portfolio!.total_unrealized_pnl
                          : portfolio!.total_realized_pnl) >= 0
                          ? "rgba(0,229,160,0.03)"
                          : "rgba(255,77,109,0.03)",
                    }
                  : {}),
              }}
            >
              <div className="text-xs mb-0.5" style={{ color: "var(--muted)" }}>{card.label}</div>
              <AnimatedNumber
                value={card.value}
                format={card.format}
                className="text-sm font-semibold"
                style={{ color: card.color }}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Tabs — sliding pill */}
      <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
        {(["holdings", "orders"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors relative"
            style={{ color: tab === t ? "var(--text)" : "var(--muted)" }}
          >
            {tab === t && (
              <motion.div
                layoutId="portfolio-tab-pill"
                className="absolute inset-x-0 bottom-0 h-0.5"
                style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            {t === "holdings" ? "Holdings" : "Order History"}
          </button>
        ))}
      </div>

      {/* Holdings table */}
      <AnimatePresence mode="wait">
        {tab === "holdings" && (
          <motion.div
            key="holdings"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="overflow-x-auto"
          >
            {portfolioLoading ? (
              <div className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
                <div className="flex justify-center gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: "var(--muted)" }}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, delay: i * 0.2, repeat: Infinity }}
                    />
                  ))}
                </div>
              </div>
            ) : !portfolio?.holdings.length ? (
              <div className="py-10 text-center">
                <div className="text-2xl mb-2">📊</div>
                <p className="text-sm" style={{ color: "var(--muted)" }}>No holdings yet.</p>
                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>Place a buy order to get started.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-xs font-semibold uppercase tracking-wider border-b"
                    style={{ color: "var(--muted)", borderColor: "var(--border)" }}
                  >
                    <th className="py-2 px-4 text-left">Ticker</th>
                    <th className="py-2 px-4 text-right">Qty</th>
                    <th className="py-2 px-4 text-right">Avg</th>
                    <th className="py-2 px-4 text-right">LTP</th>
                    <th className="py-2 px-4 text-right">P&L</th>
                    <th className="py-2 px-4 text-right">P&L%</th>
                    <th className="py-2 px-4 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.holdings.map((h, i) => {
                    const pnlColor = h.unrealized_pnl === null
                      ? "var(--muted)"
                      : h.unrealized_pnl >= 0 ? "var(--up)" : "var(--down)";
                    return (
                      <motion.tr
                        key={h.ticker}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25, delay: i * 0.05 }}
                        className="border-b cursor-pointer"
                        style={{ borderColor: "var(--border)" }}
                        onClick={() => router.push(`/stock/${h.ticker}`)}
                        whileHover={{ backgroundColor: "rgba(255,255,255,0.03)" } as never}
                      >
                        <td className="py-2.5 px-4 font-bold text-sm tracking-wide" style={{ color: "var(--text)" }}>
                          {h.ticker}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular text-sm" style={{ color: "var(--text)" }}>{h.quantity}</td>
                        <td className="py-2.5 px-4 text-right tabular text-sm" style={{ color: "var(--muted)" }}>
                          {formatINR(h.avg_buy_price)}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular text-sm" style={{ color: "var(--text)" }}>
                          {h.current_price !== null
                            ? <AnimatedNumber value={h.current_price} format={formatINR} />
                            : <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular text-sm" style={{ color: pnlColor }}>
                          {h.unrealized_pnl !== null
                            ? `${pnlSign(h.unrealized_pnl)}${formatINR(h.unrealized_pnl)}`
                            : "—"}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular text-sm" style={{ color: pnlColor }}>
                          {h.unrealized_pnl_pct !== null
                            ? `${pnlSign(h.unrealized_pnl_pct)}${h.unrealized_pnl_pct.toFixed(2)}%`
                            : "—"}
                        </td>
                        <td className="py-2.5 px-4 text-right text-xs" style={{ color: "var(--muted)" }}>→</td>
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
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="overflow-x-auto"
          >
            {ordersLoading ? (
              <div className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>Loading...</div>
            ) : !orders.length ? (
              <div className="py-10 text-center">
                <div className="text-2xl mb-2">📋</div>
                <p className="text-sm" style={{ color: "var(--muted)" }}>No orders yet.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-xs font-semibold uppercase tracking-wider border-b"
                    style={{ color: "var(--muted)", borderColor: "var(--border)" }}
                  >
                    <th className="py-2 px-4 text-left">Time</th>
                    <th className="py-2 px-4 text-left">Ticker</th>
                    <th className="py-2 px-4 text-left">Side</th>
                    <th className="py-2 px-4 text-right">Qty</th>
                    <th className="py-2 px-4 text-right">Price</th>
                    <th className="py-2 px-4 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o, i) => {
                    const pnlColor = o.realized_pnl === null
                      ? "var(--muted)"
                      : o.realized_pnl >= 0 ? "var(--up)" : "var(--down)";
                    return (
                      <motion.tr
                        key={o.order_id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25, delay: i * 0.03 }}
                        className="border-b"
                        style={{ borderColor: "var(--border)" }}
                        whileHover={{ backgroundColor: "rgba(255,255,255,0.03)" } as never}
                      >
                        <td className="py-2.5 px-4 text-xs" style={{ color: "var(--muted)" }}>
                          {new Date(o.timestamp).toLocaleString("en-IN", {
                            day: "2-digit", month: "short",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </td>
                        <td className="py-2.5 px-4 font-bold text-sm tracking-wide" style={{ color: "var(--text)" }}>
                          {o.ticker}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              color: o.side === "BUY" ? "var(--up)" : "var(--down)",
                              background: o.side === "BUY" ? "rgba(0,229,160,0.1)" : "rgba(255,77,109,0.1)",
                            }}
                          >
                            {o.side}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right tabular text-sm" style={{ color: "var(--text)" }}>{o.quantity}</td>
                        <td className="py-2.5 px-4 text-right tabular text-sm" style={{ color: "var(--text)" }}>
                          {formatINR(o.execution_price)}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular text-sm" style={{ color: pnlColor }}>
                          {o.realized_pnl !== null ? `${pnlSign(o.realized_pnl)}${formatINR(o.realized_pnl)}` : "—"}
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
  );
}
