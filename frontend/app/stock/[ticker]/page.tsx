"use client";

import { useState, useEffect, useRef, use } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";
import ChartPanel from "@/components/ChartPanel";
import OrderForm from "@/components/OrderForm";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import LiveDot from "@/components/ui/LiveDot";
import PageTransition from "@/components/ui/PageTransition";

interface Props {
  params: Promise<{ ticker: string }>;
}

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

export default function StockPage({ params }: Props) {
  const { ticker } = use(params);
  const symbol = ticker.toUpperCase();

  const { isSignedIn } = useAuth();
  const { setSelected, portfolio } = useTrading();
  const [price, setPrice] = useState<number | null>(null);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [priceError, setPriceError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const fetchPrice = async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const data = await api.getPrice(symbol, abortRef.current.signal);
        if (abortRef.current.signal.aborted) return;
        setPrevPrice((p) => (p !== null ? price : null));
        setPrice(data.price);
        setAsOf(data.as_of);
        setSelected(symbol, data.price);
        setPriceError(false);
      } catch {
        if (!abortRef.current?.signal.aborted) setPriceError(true);
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 5000);
    return () => {
      clearInterval(interval);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = price !== null && prevPrice !== null ? price - prevPrice : null;
  const changePct = change !== null && prevPrice ? (change / prevPrice) * 100 : null;
  const isUp = change === null || change >= 0;

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const holding = portfolio?.holdings.find((h) => h.ticker === symbol);

  return (
    <PageTransition className="min-h-screen flex flex-col" style={{ background: "var(--bg)" } as React.CSSProperties}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 sticky top-0 z-10"
        style={{
          background: "rgba(7,11,20,0.9)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-3">
          <Link
            href={isSignedIn ? "/dashboard" : "/"}
            className="text-sm transition-colors"
            style={{ color: "var(--muted)" }}
          >
            ←
          </Link>
          <span style={{ color: "var(--border)" }}>|</span>
          <span className="font-black tracking-widest text-sm" style={{ color: "var(--text)" }}>{symbol}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <LiveDot />
          <span className="text-xs font-medium" style={{ color: "var(--up)" }}>Live</span>
        </div>
      </header>

      {/* Price bar */}
      <div
        className="px-4 py-4"
        style={{
          background: "rgba(7,11,20,0.6)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          {price !== null ? (
            <>
              <motion.div
                key={Math.round(price)}
                initial={{ opacity: 0.7 }}
                animate={{ opacity: 1 }}
              >
                <AnimatedNumber
                  value={price}
                  format={formatINR}
                  className="text-3xl font-black"
                  style={{ color: "var(--text)" }}
                />
              </motion.div>
              {change !== null && changePct !== null && (
                <span
                  className="text-sm tabular font-semibold px-2 py-0.5 rounded-lg"
                  style={{
                    color: isUp ? "var(--up)" : "var(--down)",
                    background: isUp ? "rgba(0,229,160,0.1)" : "rgba(255,77,109,0.1)",
                  }}
                >
                  {isUp ? "▲" : "▼"} {change >= 0 ? "+" : ""}{change.toFixed(2)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
                </span>
              )}
              {asOf && (
                <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>{formatTime(asOf)}</span>
              )}
            </>
          ) : priceError ? (
            <span className="text-sm" style={{ color: "var(--down)" }}>Price unavailable</span>
          ) : (
            <div className="h-8 w-40 rounded-lg animate-pulse" style={{ background: "var(--surface-2)" }} />
          )}
        </div>
        {holding && (
          <div className="mt-2 flex gap-4 text-xs flex-wrap" style={{ color: "var(--muted)" }}>
            <span>
              Holding:{" "}
              <span className="font-semibold" style={{ color: "var(--text)" }}>{holding.quantity} shares</span>
            </span>
            <span>
              Avg:{" "}
              <span className="font-semibold tabular" style={{ color: "var(--text)" }}>
                {formatINR(holding.avg_buy_price)}
              </span>
            </span>
            {holding.unrealized_pnl !== null && (
              <span>
                P&L:{" "}
                <span
                  className="font-semibold tabular"
                  style={{ color: holding.unrealized_pnl >= 0 ? "var(--up)" : "var(--down)" }}
                >
                  {holding.unrealized_pnl >= 0 ? "+" : ""}{formatINR(holding.unrealized_pnl)}
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Chart + Order form */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Chart */}
        <div
          className="flex-1 min-h-[340px] lg:min-h-0"
          style={{
            background: "rgba(7,11,20,0.8)",
            borderRight: "1px solid var(--border)",
          }}
        >
          <ChartPanel ticker={symbol} />
        </div>

        {/* Order form / sign-in prompt */}
        <div
          className="lg:w-72"
          style={{
            background: "var(--surface)",
            backdropFilter: "blur(var(--glass-blur))",
            WebkitBackdropFilter: "blur(var(--glass-blur))",
          }}
        >
          {isSignedIn ? (
            <OrderForm />
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="p-6 flex flex-col items-center justify-center h-full min-h-[200px] text-center"
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mb-4"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              >
                🔒
              </div>
              <h3 className="font-bold text-sm mb-2" style={{ color: "var(--text)" }}>
                Sign in to trade
              </h3>
              <p className="text-xs mb-6 leading-relaxed" style={{ color: "var(--muted)" }}>
                Create a free account and get ₹1,00,000 to start trading
              </p>
              <Link
                href="/sign-up"
                className="block w-full text-center py-2.5 rounded-xl font-bold text-sm text-white shimmer-btn mb-2"
                style={{
                  background: "var(--accent)",
                  boxShadow: "0 0 20px var(--accent-glow)",
                }}
              >
                Get Started →
              </Link>
              <Link
                href="/sign-in"
                className="block w-full text-center py-2.5 rounded-xl text-sm font-medium"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--muted)",
                }}
              >
                Sign In
              </Link>
            </motion.div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
