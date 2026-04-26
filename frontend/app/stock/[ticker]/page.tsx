"use client";

import { useState, useEffect, useRef, use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";
import ChartPanel from "@/components/ChartPanel";
import OrderForm from "@/components/OrderForm";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import { getTickerName } from "@/lib/ticker-names";
import TerminalShell from "@/components/TerminalShell";

interface Props { params: Promise<{ ticker: string }> }

const fmtINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

export default function StockPage({ params }: Props) {
  const { ticker } = use(params);
  const symbol = ticker.toUpperCase();
  const { isSignedIn } = useAuth();
  const { setSelected, portfolio, watchlist, addToWatchlist, removeFromWatchlist } = useTrading();

  const [price, setPrice]         = useState<number | null>(null);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);
  const [priceError, setPriceError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const fetch = async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const data = await api.getPrice(symbol, abortRef.current.signal);
        if (abortRef.current.signal.aborted) return;
        setPrevPrice((p) => (p !== null ? price : null));
        setPrice(data.price);
        setSelected(symbol, data.price);
        setPriceError(false);
      } catch {
        if (!abortRef.current?.signal.aborted) setPriceError(true);
      }
    };
    fetch();
    const id = setInterval(fetch, 5000);
    return () => { clearInterval(id); abortRef.current?.abort(); };
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const change    = price !== null && prevPrice !== null ? price - prevPrice : null;
  const changePct = change !== null && prevPrice ? (change / prevPrice) * 100 : null;
  const isUp      = change === null || change >= 0;
  const holding   = portfolio?.holdings.find((h) => h.ticker === symbol);
  const name      = getTickerName(symbol);

  return (
    <TerminalShell>
      {/*
        Desktop: two-column split — chart left, order entry right
        Mobile: stacked, chart 50vh then order form
      */}
      <div className="flex flex-col md:flex-row md:h-[calc(100vh-92px)] md:overflow-hidden">

        {/* ── Left: Stock info + Chart ─────────────────────── */}
        <div className="flex-1 flex flex-col md:overflow-hidden">
          {/* Stock header */}
          <div
            className="px-5 py-4 flex-shrink-0 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 mb-3">
              <Link
                href={isSignedIn ? "/dashboard" : "/"}
                className="text-xs transition-colors"
                style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
              >
                ← BACK
              </Link>
              <span style={{ color: "var(--border-2)" }}>·</span>
              <span className="text-xs" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}>NSE</span>
              <span className="live-dot ml-1" />
            </div>

            {/* Name + symbol + watchlist button */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <span
                  className="font-black tracking-tight"
                  style={{
                    fontSize: "clamp(1.5rem, 4vw, 2.5rem)",
                    color: "var(--text)",
                    fontFamily: "var(--font-geist-sans)",
                    lineHeight: 1.1,
                  }}
                >
                  {name ?? symbol}
                </span>
                <span
                  className="text-sm font-semibold tracking-wider mt-0.5"
                  style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}
                >
                  {symbol}
                </span>
              </div>
              {(() => {
                const inList = watchlist.includes(symbol);
                return (
                  <button
                    onClick={() => inList ? removeFromWatchlist(symbol) : addToWatchlist(symbol)}
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-bold tracking-widest transition-colors mt-1"
                    style={{
                      fontFamily: "var(--font-geist-mono)",
                      border: `1px solid ${inList ? "var(--accent)" : "var(--border-2)"}`,
                      borderRadius: "2px",
                      background: inList ? "var(--accent-dim)" : "transparent",
                      color: inList ? "var(--accent)" : "var(--muted)",
                      cursor: "pointer",
                    }}
                  >
                    {inList ? "★ WATCHING" : "+ WATCHLIST"}
                  </button>
                );
              })()}
            </div>

            {/* Big price */}
            <div className="flex flex-wrap items-end gap-3 mt-2">
              {price !== null ? (
                <>
                  <AnimatedNumber
                    value={price}
                    format={fmtINR}
                    className="font-black"
                    style={{
                      fontSize: "clamp(2rem, 7vw, 4rem)",
                      color: "var(--text)",
                      fontFamily: "var(--font-geist-mono)",
                      lineHeight: 1,
                    }}
                  />
                  {change !== null && changePct !== null && (
                    <span
                      className="text-sm font-bold tabular"
                      style={{ color: isUp ? "var(--up)" : "var(--down)", fontFamily: "var(--font-geist-mono)" }}
                    >
                      {isUp ? "▲ +" : "▼ "}{change.toFixed(2)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
                    </span>
                  )}
                </>
              ) : priceError ? (
                <span className="text-sm font-mono" style={{ color: "var(--down)" }}>PRICE_UNAVAILABLE</span>
              ) : (
                <div className="h-10 w-48 rounded-sm animate-pulse" style={{ background: "var(--surface-2)" }} />
              )}
            </div>

            {/* Holding info */}
            {holding && (
              <div className="flex gap-4 mt-2 flex-wrap">
                {[
                  { label: "HOLDING", value: `${holding.quantity} shares` },
                  { label: "AVG", value: fmtINR(holding.avg_buy_price) },
                  ...(holding.unrealized_pnl !== null ? [{
                    label: "P&L",
                    value: `${holding.unrealized_pnl >= 0 ? "+" : ""}${fmtINR(holding.unrealized_pnl)}`,
                    color: holding.unrealized_pnl >= 0 ? "var(--up)" : "var(--down)",
                  }] : []),
                ].map((item) => (
                  <span key={item.label} className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
                    {item.label}:{" "}
                    <span style={{ color: (item as { color?: string }).color ?? "var(--text)", fontWeight: 600 }}>
                      {item.value}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Chart — fills remaining height */}
          <div className="flex-1 min-h-[240px] sm:min-h-[300px] md:min-h-0 md:overflow-hidden">
            <ChartPanel ticker={symbol} />
          </div>
        </div>

        {/* ── Right: Order entry ───────────────────────────── */}
        <div
          className="md:w-72 md:flex-shrink-0 flex flex-col border-t md:border-t-0 md:border-l pb-16 md:pb-0"
          style={{ borderColor: "var(--border)" }}
        >
          {isSignedIn ? (
            <OrderForm />
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col items-center justify-center h-full min-h-[220px] px-6 pt-6 pb-24 md:p-6 text-center"
              style={{ background: "var(--surface)" }}
            >
              <div
                className="text-xs font-semibold tracking-widest mb-4"
                style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
              >
                _ORDER_ENTRY
              </div>
              <div
                className="px-3 py-2 mb-4 text-xs font-mono"
                style={{ border: "1px solid var(--border)", color: "var(--muted)", borderRadius: "2px" }}
              >
                ACCESS RESTRICTED
              </div>
              <p className="text-xs mb-6" style={{ color: "var(--muted)" }}>
                Create a free account to start trading with ₹1,00,000 virtual balance.
              </p>
              <Link
                href="/sign-up"
                className="block w-full text-center py-2.5 text-xs font-bold mb-2 shimmer-btn"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  fontFamily: "var(--font-geist-mono)",
                  letterSpacing: "0.06em",
                  borderRadius: "2px",
                }}
              >
                _START_TRADING
              </Link>
              <Link
                href="/sign-in"
                className="hidden md:block w-full text-center py-2.5 text-xs font-semibold"
                style={{
                  border: "1px solid var(--border-2)",
                  color: "var(--muted)",
                  fontFamily: "var(--font-geist-mono)",
                  borderRadius: "2px",
                }}
              >
                _SIGN_IN
              </Link>
            </motion.div>
          )}
        </div>

      </div>
    </TerminalShell>
  );
}
