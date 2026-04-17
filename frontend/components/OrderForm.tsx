"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
import { api, ApiError } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";
import AnimatedNumber from "./ui/AnimatedNumber";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

let toastId = 0;

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

export default function OrderForm() {
  const { getToken } = useAuth();
  const { selectedTicker, selectedPrice, portfolio, refreshPortfolio } = useTrading();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [ticker, setTicker] = useState("");
  const [qty, setQty] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [inputFocused, setInputFocused] = useState<string | null>(null);

  useEffect(() => {
    if (selectedTicker) setTicker(selectedTicker);
  }, [selectedTicker]);

  const currentPrice = selectedTicker === ticker ? selectedPrice : null;
  const estimated = currentPrice && qty ? currentPrice * parseInt(qty || "0") : null;
  const balance = portfolio?.available_balance ?? null;

  const holding = portfolio?.holdings.find((h) => h.ticker === ticker);
  const maxSell = holding?.quantity ?? 0;

  const qtyInt = parseInt(qty);
  const canSubmit =
    !submitting &&
    ticker.trim().length > 0 &&
    qtyInt > 0 &&
    Number.isInteger(qtyInt) &&
    (side === "BUY" || maxSell > 0);

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
        const result = await api.buy(ticker.toUpperCase(), qtyInt, token);
        addToast(`Bought ${qtyInt} ${ticker} @ ${formatINR(result.execution_price)}`, "success");
      } else {
        const result = await api.sell(ticker.toUpperCase(), qtyInt, token);
        const pnl = result.realized_pnl;
        const pnlStr = pnl !== undefined ? ` · P&L: ${pnl >= 0 ? "+" : ""}${formatINR(pnl)}` : "";
        addToast(`Sold ${qtyInt} ${ticker} @ ${formatINR(result.execution_price)}${pnlStr}`, "success");
      }
      setQty("");
      setSubmitting(false);       // reset button immediately
      refreshPortfolio();         // refresh portfolio in background, don't await
    } catch (e) {
      if (e instanceof ApiError) {
        addToast(e.message, "error");
      } else {
        addToast("Order failed", "error");
      }
      setSubmitting(false);
    }
  };

  const sideColor = side === "BUY" ? "var(--up)" : "var(--down)";
  const sideGlow = side === "BUY" ? "rgba(0,229,160,0.25)" : "rgba(255,77,109,0.25)";

  return (
    <div
      className="flex flex-col h-full p-4 gap-4 relative"
      style={{ background: "var(--surface)" }}
    >
      {/* Toasts */}
      <div className="fixed bottom-24 right-4 z-50 flex flex-col gap-2 pointer-events-none" style={{ maxWidth: "calc(100vw - 2rem)" }}>
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 40, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="px-4 py-3 rounded-xl text-sm font-medium pointer-events-auto flex items-start gap-3"
              style={{
                background: "var(--overlay)",
                backdropFilter: "blur(20px)",
                border: `1px solid ${t.type === "success" ? "rgba(0,229,160,0.3)" : "rgba(255,77,109,0.3)"}`,
                borderLeft: `3px solid ${t.type === "success" ? "var(--up)" : "var(--down)"}`,
                color: "var(--text)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                maxWidth: "340px",
              }}
            >
              <span style={{ color: t.type === "success" ? "var(--up)" : "var(--down)" }}>
                {t.type === "success" ? "✓" : "✕"}
              </span>
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        Place Order
      </h2>

      {/* BUY / SELL toggle — sliding pill */}
      <div
        className="flex rounded-xl overflow-hidden relative"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
      >
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className="relative flex-1 py-2.5 text-sm font-bold transition-colors z-10"
            style={{
              color: side === s ? "#fff" : "var(--muted)",
            }}
          >
            {side === s && (
              <motion.div
                layoutId="order-side-pill"
                className="absolute inset-0"
                style={{
                  background: s === "BUY" ? "var(--up)" : "var(--down)",
                  boxShadow: `0 0 20px ${s === "BUY" ? "rgba(0,229,160,0.3)" : "rgba(255,77,109,0.3)"}`,
                }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative z-10">{s}</span>
          </button>
        ))}
      </div>

      {/* Ticker */}
      <div>
        <label className="text-xs mb-1.5 block font-medium" style={{ color: "var(--muted)" }}>Ticker</label>
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onFocus={() => setInputFocused("ticker")}
          onBlur={() => setInputFocused(null)}
          placeholder="e.g. RELIANCE"
          className="w-full text-sm px-3 py-2.5 rounded-xl transition-all focus:outline-none font-bold tracking-wider"
          style={{
            background: "var(--surface-2)",
            color: "var(--text)",
            border: `1px solid ${inputFocused === "ticker" ? "rgba(91,139,255,0.5)" : "var(--border)"}`,
            boxShadow: inputFocused === "ticker" ? "0 0 0 3px rgba(91,139,255,0.1)" : "none",
          }}
        />
      </div>

      {/* Quantity */}
      <div>
        <label className="text-xs mb-1.5 flex items-center justify-between font-medium" style={{ color: "var(--muted)" }}>
          <span>Quantity</span>
          {side === "SELL" && maxSell > 0 && (
            <span className="font-normal">Available: <strong style={{ color: "var(--text)" }}>{maxSell}</strong></span>
          )}
        </label>
        <input
          type="number"
          value={qty}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || (/^\d+$/.test(v) && parseInt(v) > 0)) setQty(v);
          }}
          onFocus={() => setInputFocused("qty")}
          onBlur={() => setInputFocused(null)}
          min="1"
          step="1"
          placeholder="0"
          className="w-full text-sm px-3 py-2.5 rounded-xl transition-all focus:outline-none tabular"
          style={{
            background: "var(--surface-2)",
            color: "var(--text)",
            border: `1px solid ${inputFocused === "qty" ? "rgba(91,139,255,0.5)" : "var(--border)"}`,
            boxShadow: inputFocused === "qty" ? "0 0 0 3px rgba(91,139,255,0.1)" : "none",
          }}
        />
      </div>

      {/* Summary */}
      <div
        className="rounded-xl p-3 space-y-2"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
        }}
      >
        <div className="flex justify-between text-xs">
          <span style={{ color: "var(--muted)" }}>Market Price</span>
          <span className="tabular font-medium" style={{ color: "var(--text)" }}>
            {currentPrice ? (
              <AnimatedNumber value={currentPrice} format={formatINR} />
            ) : "—"}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span style={{ color: "var(--muted)" }}>Est. {side === "BUY" ? "Cost" : "Proceeds"}</span>
          <span className="tabular font-bold" style={{ color: "var(--text)" }}>
            {estimated ? (
              <AnimatedNumber value={estimated} format={formatINR} />
            ) : "—"}
          </span>
        </div>
        <div className="border-t pt-2 flex justify-between text-xs" style={{ borderColor: "var(--border)" }}>
          <span style={{ color: "var(--muted)" }}>Balance</span>
          <span
            className="tabular font-medium"
            style={{
              color:
                balance !== null && estimated !== null && side === "BUY" && estimated > balance
                  ? "var(--down)"
                  : "var(--text)",
            }}
          >
            {balance !== null ? formatINR(balance) : "—"}
          </span>
        </div>
      </div>

      {/* Submit */}
      <motion.button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full py-3 rounded-xl text-sm font-bold shimmer-btn"
        style={{
          background: !canSubmit ? "var(--surface-2)" : sideColor,
          color: !canSubmit ? "var(--muted)" : side === "BUY" ? "#070B14" : "#fff",
          cursor: !canSubmit ? "not-allowed" : "pointer",
          border: `1px solid ${!canSubmit ? "var(--border)" : sideColor}`,
          boxShadow: canSubmit ? `0 0 20px ${sideGlow}` : "none",
        }}
        whileTap={canSubmit ? { scale: 0.96 } : undefined}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="inline-block w-4 h-4 border-2 rounded-full"
              style={{ borderColor: "currentColor", borderTopColor: "transparent" }}
            />
            Placing Order...
          </span>
        ) : (
          `Place ${side} Order`
        )}
      </motion.button>
    </div>
  );
}
