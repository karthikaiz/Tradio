"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
import { api, ApiError } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";
import AnimatedNumber from "./ui/AnimatedNumber";

interface Toast { id: number; message: string; type: "success" | "error" }
let toastId = 0;

const fmtINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

const fmtBal = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

export default function OrderForm() {
  const { getToken } = useAuth();
  const { selectedTicker, selectedPrice, portfolio, refreshPortfolio } = useTrading();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [ticker, setTicker] = useState("");
  const [qty, setQty] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => { if (selectedTicker) setTicker(selectedTicker); }, [selectedTicker]);

  const currentPrice = selectedTicker === ticker ? selectedPrice : null;
  const estimated = currentPrice && qty ? currentPrice * parseInt(qty || "0") : null;
  const balance = portfolio?.available_balance ?? null;
  const holding = portfolio?.holdings.find((h) => h.ticker === ticker);
  const maxSell = holding?.quantity ?? 0;
  const qtyInt = parseInt(qty);
  const canSubmit = !submitting && ticker.trim().length > 0 && qtyInt > 0 && Number.isInteger(qtyInt) && (side === "BUY" || maxSell > 0);

  const addToast = (message: string, type: "success" | "error") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      if (side === "BUY") {
        const r = await api.buy(ticker.toUpperCase(), qtyInt, token);
        addToast(`BOUGHT ${qtyInt} ${ticker} @ ${fmtINR(r.execution_price)}`, "success");
      } else {
        const r = await api.sell(ticker.toUpperCase(), qtyInt, token);
        const pnl = r.realized_pnl;
        const pnlStr = pnl !== undefined ? `  P&L: ${pnl >= 0 ? "+" : ""}${fmtINR(pnl)}` : "";
        addToast(`SOLD ${qtyInt} ${ticker} @ ${fmtINR(r.execution_price)}${pnlStr}`, "success");
      }
      setQty("");
      setSubmitting(false);
      refreshPortfolio();
    } catch (e) {
      addToast(e instanceof ApiError ? e.message : "ORDER FAILED", "error");
      setSubmitting(false);
    }
  };

  const isBuy = side === "BUY";

  return (
    <div className="flex flex-col h-full relative" style={{ background: "var(--surface)" }}>
      {/* Terminal toasts */}
      <div className="fixed bottom-16 md:bottom-10 right-3 z-50 flex flex-col gap-2 pointer-events-none" style={{ maxWidth: "320px" }}>
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="px-3 py-2.5 pointer-events-auto"
              style={{
                background: "var(--surface)",
                border: `1px solid ${t.type === "success" ? "var(--up)" : "var(--down)"}`,
                borderLeft: `3px solid ${t.type === "success" ? "var(--up)" : "var(--down)"}`,
                borderRadius: "2px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
              }}
            >
              <span
                className="text-xs font-semibold"
                style={{
                  color: t.type === "success" ? "var(--up)" : "var(--down)",
                  fontFamily: "var(--font-geist-mono)",
                  letterSpacing: "0.03em",
                }}
              >
                {t.type === "success" ? "✓ " : "✕ "}{t.message}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Header */}
      <div
        className="px-4 py-2.5 border-b flex items-center justify-between flex-shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="text-xs font-semibold tracking-widest"
          style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
        >
          _ORDER_ENTRY
        </span>
        <span className="text-xs" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}>
          MARKET
        </span>
      </div>

      <div className="p-4 flex flex-col gap-4 flex-1">
        {/* BUY / SELL */}
        <div className="flex border" style={{ borderColor: "var(--border-2)", borderRadius: "2px" }}>
          {(["BUY", "SELL"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className="flex-1 py-2 text-xs font-bold tracking-widest transition-colors"
              style={{
                fontFamily: "var(--font-geist-mono)",
                background: side === s ? (s === "BUY" ? "var(--up)" : "var(--down)") : "transparent",
                color: side === s ? "var(--bg)" : "var(--muted)",
                borderRadius: 0,
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Ticker input */}
        <div>
          <div
            className="text-xs mb-1"
            style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
          >
            &gt; TICKER:
          </div>
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="RELIANCE"
            className="w-full bg-transparent focus:outline-none text-sm font-bold pb-1"
            style={{
              color: "var(--text)",
              fontFamily: "var(--font-geist-mono)",
              borderBottom: "1px solid var(--border-2)",
              letterSpacing: "0.08em",
            }}
          />
        </div>

        {/* Quantity */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span
              className="text-xs"
              style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
            >
              &gt; QTY:
            </span>
            {side === "SELL" && maxSell > 0 && (
              <span
                className="text-xs"
                style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}
              >
                MAX: {maxSell}
              </span>
            )}
          </div>
          <input
            type="number"
            value={qty}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || (/^\d+$/.test(v) && parseInt(v) > 0)) setQty(v);
            }}
            min="1"
            step="1"
            placeholder="0"
            className="w-full bg-transparent focus:outline-none text-sm font-bold pb-1 tabular"
            style={{
              color: "var(--text)",
              fontFamily: "var(--font-geist-mono)",
              borderBottom: "1px solid var(--border-2)",
            }}
          />
        </div>

        {/* Margin info */}
        <div
          className="space-y-1.5 pt-2 border-t"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
              MKT PRICE
            </span>
            <span className="text-xs" style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}>
              {currentPrice ? fmtINR(currentPrice) : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
              REQ MARGIN
            </span>
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}
            >
              {estimated ? fmtINR(estimated) : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
              AVAILABLE
            </span>
            <AnimatedNumber
              value={balance ?? 0}
              format={fmtBal}
              className="text-xs font-semibold"
              style={{
                color: balance !== null && estimated !== null && side === "BUY" && estimated > balance
                  ? "var(--down)"
                  : "var(--up)",
                fontFamily: "var(--font-geist-mono)",
              }}
            />
          </div>
        </div>

        {/* Execute */}
        <motion.button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-3 text-xs font-black tracking-widest mt-auto shimmer-btn"
          style={{
            fontFamily: "var(--font-geist-mono)",
            letterSpacing: "0.08em",
            background: !canSubmit ? "var(--surface-2)" : isBuy ? "var(--up)" : "var(--down)",
            color: !canSubmit ? "var(--muted)" : "var(--bg)",
            cursor: !canSubmit ? "not-allowed" : "pointer",
            borderRadius: "2px",
            border: `1px solid ${!canSubmit ? "var(--border)" : isBuy ? "var(--up)" : "var(--down)"}`,
          }}
          whileTap={canSubmit ? { scale: 0.97 } : undefined}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="inline-block w-3 h-3 border-2 rounded-full"
                style={{ borderColor: "currentColor", borderTopColor: "transparent" }}
              />
              PROCESSING...
            </span>
          ) : (
            `_EXECUTE_${side}`
          )}
        </motion.button>
      </div>
    </div>
  );
}
