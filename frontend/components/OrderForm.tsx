"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { motion, AnimatePresence } from "framer-motion";
import { api, ApiError, TradeReason, CoachFeedbackResponse } from "@/lib/api";
import { getTickerName } from "@/lib/ticker-names";
import { useTrading } from "@/lib/trading-context";
import AnimatedNumber from "./ui/AnimatedNumber";

interface Toast { id: number; message: string; type: "success" | "error" }
let toastId = 0;

const fmtINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

const fmtBal = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

const REASONS: { value: TradeReason; label: string }[] = [
  { value: "MOMENTUM",      label: "Momentum" },
  { value: "NEWS",          label: "News / Event" },
  { value: "LONG_TERM",     label: "Long Term" },
  { value: "CHART_PATTERN", label: "Chart Pattern" },
  { value: "SECTOR_TREND",  label: "Sector Trend" },
  { value: "GUT_FEELING",   label: "Gut Feeling" },
  { value: "FRIEND_TIP",    label: "Friend Tip" },
  { value: "CUSTOM",        label: "Custom..." },
];

type Phase = "entry" | "reason" | "coaching" | "review" | "confirming";

const TONE_COLOR: Record<string, string> = {
  positive: "var(--up)",
  warning:  "#f59e0b",
  info:     "var(--accent)",
};

const HEADER_LABEL: Partial<Record<Phase, string>> = {
  reason:   "_WHY_THIS_TRADE",
  coaching: "AI_COACH",
  review:   "AI_COACH",
};

export default function OrderForm() {
  const { getToken } = useAuth();
  const { selectedTicker, selectedPrice, portfolio, refreshPortfolio } = useTrading();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState("");
  const [phase, setPhase] = useState<Phase>("entry");
  const [pendingReason, setPendingReason] = useState<TradeReason | null>(null);
  const [customText, setCustomText] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [coachAdvice, setCoachAdvice] = useState<CoachFeedbackResponse | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const ticker = selectedTicker ?? "";
  const currentPrice = selectedPrice;
  const estimated = currentPrice && qty ? currentPrice * parseInt(qty || "0") : null;
  const balance = portfolio?.available_balance ?? null;
  const holding = portfolio?.holdings.find((h) => h.ticker === ticker);
  const maxSell = holding?.quantity ?? 0;
  const qtyInt = parseInt(qty);
  const canSubmit =
    phase === "entry" &&
    ticker.trim().length > 0 &&
    qtyInt > 0 &&
    Number.isInteger(qtyInt) &&
    (side === "BUY" || maxSell > 0);

  const addToast = (message: string, type: "success" | "error") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  };

  const reset = () => {
    setPendingReason(null);
    setCustomText("");
    setShowCustomInput(false);
    setCoachAdvice(null);
    setPhase("entry");
  };

  // Step 1: user picks a reason → fetch coach advice BEFORE trade fires
  const fetchCoachAdvice = async (reason: TradeReason | null) => {
    setPendingReason(reason);
    setPhase("coaching");

    const token = await getToken();
    if (!token) { reset(); return; }

    const p = portfolio;
    try {
      const advice = await api.getCoachFeedback({
        ticker: ticker.toUpperCase(),
        side,
        quantity: qtyInt,
        execution_price: currentPrice ?? 0,
        trade_reason: reason,
        custom_reason: reason === "CUSTOM" ? customText.trim() || null : null,
        portfolio_context: {
          available_balance: p?.available_balance ?? 0,
          total_invested: p?.total_invested ?? 0,
          total_unrealized_pnl: p?.total_unrealized_pnl ?? 0,
          total_unrealized_pnl_pct: p?.total_unrealized_pnl_pct ?? 0,
          holdings: (p?.holdings ?? []).map((h) => ({
            ticker: h.ticker,
            name: getTickerName(h.ticker) ?? h.ticker,
            quantity: h.quantity,
            avg_buy_price: h.avg_buy_price,
            current_price: h.current_price,
            invested_value: h.invested_value,
            unrealized_pnl: h.unrealized_pnl,
            unrealized_pnl_pct: h.unrealized_pnl_pct,
          })),
        },
      }, token);
      setCoachAdvice(advice);
    } catch {
      setCoachAdvice({
        feedback: "Coach unavailable right now — proceed with your own judgment.",
        tone: "info",
      });
    }
    setPhase("review");
  };

  // Step 2: user reads advice and clicks EXECUTE → trade fires
  const executeTrade = async () => {
    setPhase("confirming");
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      if (side === "BUY") {
        const r = await api.buy(ticker.toUpperCase(), qtyInt, token, pendingReason);
        addToast(`BOUGHT ${qtyInt} ${ticker} @ ${fmtINR(r.execution_price)}`, "success");
      } else {
        const r = await api.sell(ticker.toUpperCase(), qtyInt, token, pendingReason);
        const pnlStr = r.realized_pnl !== undefined
          ? `  P&L: ${r.realized_pnl >= 0 ? "+" : ""}${fmtINR(r.realized_pnl)}`
          : "";
        addToast(`SOLD ${qtyInt} ${ticker} @ ${fmtINR(r.execution_price)}${pnlStr}`, "success");
      }

      setQty("");
      refreshPortfolio();
      reset();
    } catch (e) {
      addToast(e instanceof ApiError ? e.message : "ORDER FAILED", "error");
      setPhase("review"); // keep advice visible so user can retry
    }
  };

  const isBuy = side === "BUY";

  return (
    <div className="flex flex-col h-full relative" style={{ background: "var(--surface)" }}>
      {/* Toasts */}
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
                style={{ color: t.type === "success" ? "var(--up)" : "var(--down)", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.03em" }}
              >
                {t.type === "success" ? "✓ " : "✕ "}{t.message}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Header */}
      <div className="px-4 py-2.5 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: "var(--border)" }}>
        <span className="text-xs font-semibold tracking-widest" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
          {HEADER_LABEL[phase] ?? "_ORDER_ENTRY"}
        </span>
        <span className="text-xs" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}>MARKET</span>
      </div>

      <AnimatePresence mode="wait">
        {/* ── Reason picker ── */}
        {phase === "reason" && (
          <motion.div
            key="reason"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="p-4 flex flex-col gap-3 flex-1"
          >
            <p className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
              &gt; SELECT_REASON:
            </p>
            <div className="grid grid-cols-2 gap-2">
              {REASONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => {
                    if (value === "CUSTOM") {
                      setShowCustomInput(true);
                    } else {
                      setShowCustomInput(false);
                      fetchCoachAdvice(value);
                    }
                  }}
                  className="py-2 px-2 text-xs font-semibold text-left transition-colors"
                  style={{
                    fontFamily: "var(--font-geist-mono)",
                    background: showCustomInput && value === "CUSTOM" ? "var(--surface-3, var(--surface-2))" : "var(--surface-2)",
                    border: `1px solid ${showCustomInput && value === "CUSTOM" ? (isBuy ? "var(--up)" : "var(--down)") : "var(--border-2)"}`,
                    borderRadius: "2px",
                    color: showCustomInput && value === "CUSTOM" ? (isBuy ? "var(--up)" : "var(--down)") : "var(--text)",
                    letterSpacing: "0.02em",
                  }}
                  onMouseEnter={(e) => {
                    if (showCustomInput && value === "CUSTOM") return;
                    (e.currentTarget as HTMLButtonElement).style.borderColor = isBuy ? "var(--up)" : "var(--down)";
                    (e.currentTarget as HTMLButtonElement).style.color = isBuy ? "var(--up)" : "var(--down)";
                  }}
                  onMouseLeave={(e) => {
                    if (showCustomInput && value === "CUSTOM") return;
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-2)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Custom reason text input */}
            <AnimatePresence>
              {showCustomInput && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex gap-2"
                >
                  <input
                    autoFocus
                    type="text"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customText.trim()) fetchCoachAdvice("CUSTOM");
                    }}
                    placeholder="e.g. Q4 earnings beat, strong guidance..."
                    maxLength={120}
                    className="flex-1 bg-transparent focus:outline-none text-xs pb-1"
                    style={{
                      color: "var(--text)",
                      fontFamily: "var(--font-geist-mono)",
                      borderBottom: `1px solid ${isBuy ? "var(--up)" : "var(--down)"}`,
                    }}
                  />
                  <button
                    onClick={() => { if (customText.trim()) fetchCoachAdvice("CUSTOM"); }}
                    disabled={!customText.trim()}
                    className="text-xs font-bold px-2 transition-colors"
                    style={{
                      fontFamily: "var(--font-geist-mono)",
                      color: customText.trim() ? (isBuy ? "var(--up)" : "var(--down)") : "var(--muted)",
                    }}
                  >
                    →
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={() => fetchCoachAdvice(null)}
              className="w-full py-2 text-xs mt-auto transition-colors"
              style={{
                fontFamily: "var(--font-geist-mono)",
                color: "var(--text-dim)",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "2px",
              }}
            >
              SKIP →
            </button>
          </motion.div>
        )}

        {/* ── Coach analysing spinner ── */}
        {phase === "coaching" && (
          <motion.div
            key="coaching"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-center justify-center flex-1 gap-3"
          >
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
              className="inline-block w-4 h-4 border-2 rounded-full"
              style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
            />
            <span className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.06em" }}>
              ANALYSING TRADE...
            </span>
          </motion.div>
        )}

        {/* ── Coach review: read advice, then decide ── */}
        {phase === "review" && coachAdvice && (
          <motion.div
            key="review"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="p-4 flex flex-col gap-3 flex-1"
          >
            <div
              className="p-3 flex-1"
              style={{
                border: `1px solid ${TONE_COLOR[coachAdvice.tone] ?? "var(--border)"}`,
                borderLeft: `3px solid ${TONE_COLOR[coachAdvice.tone] ?? "var(--border)"}`,
                borderRadius: "2px",
                background: "var(--surface-2)",
              }}
            >
              <p className="text-xs leading-relaxed" style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}>
                {coachAdvice.feedback}
              </p>
            </div>
            <span className="text-xs" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}>
              {coachAdvice.tone === "positive" ? "✓ POSITIVE" : coachAdvice.tone === "warning" ? "⚠ NOTE" : "ℹ INFO"}
            </span>

            {/* Execute button */}
            <motion.button
              onClick={executeTrade}
              className="w-full py-3 text-xs font-black tracking-widest shimmer-btn"
              style={{
                fontFamily: "var(--font-geist-mono)",
                letterSpacing: "0.08em",
                background: isBuy ? "var(--up)" : "var(--down)",
                color: "var(--bg)",
                borderRadius: "2px",
                border: `1px solid ${isBuy ? "var(--up)" : "var(--down)"}`,
              }}
              whileTap={{ scale: 0.97 }}
            >
              {`EXECUTE ${side} →`}
            </motion.button>

            {/* Cancel */}
            <button
              onClick={reset}
              className="w-full py-2 text-xs transition-colors"
              style={{
                fontFamily: "var(--font-geist-mono)",
                color: "var(--text-dim)",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "2px",
              }}
            >
              CANCEL
            </button>
          </motion.div>
        )}

        {/* ── Order entry ── */}
        {(phase === "entry" || phase === "confirming") && (
          <motion.div
            key="entry"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="p-4 flex flex-col gap-4 flex-1"
          >
            {/* BUY / SELL toggle */}
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

            {/* Quantity */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
                  &gt; QTY:
                </span>
                {side === "SELL" && maxSell > 0 && (
                  <span className="text-xs" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}>
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
                style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)", borderBottom: "1px solid var(--border-2)" }}
              />
            </div>

            {/* Margin info */}
            <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              {[
                { label: "MKT PRICE", value: currentPrice ? fmtINR(currentPrice) : "—", color: "var(--text)" },
                { label: "REQ MARGIN", value: estimated ? fmtINR(estimated) : "—", color: "var(--text)" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>{label}</span>
                  <span className="text-xs font-semibold" style={{ color, fontFamily: "var(--font-geist-mono)" }}>{value}</span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>AVAILABLE</span>
                <AnimatedNumber
                  value={balance ?? 0}
                  format={fmtBal}
                  className="text-xs font-semibold"
                  style={{
                    color: balance !== null && estimated !== null && side === "BUY" && estimated > balance
                      ? "var(--down)" : "var(--up)",
                    fontFamily: "var(--font-geist-mono)",
                  }}
                />
              </div>
            </div>

            {/* Execute → reason picker */}
            <motion.button
              onClick={() => setPhase("reason")}
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
              {`_EXECUTE_${side}`}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirming overlay — sits on top of review screen */}
      <AnimatePresence>
        {phase === "confirming" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
          >
            <div className="flex flex-col items-center gap-3">
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="inline-block w-5 h-5 border-2 rounded-full"
                style={{ borderColor: isBuy ? "var(--up)" : "var(--down)", borderTopColor: "transparent" }}
              />
              <span className="text-xs font-semibold" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.06em" }}>
                PROCESSING...
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
