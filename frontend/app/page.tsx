"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import Navbar from "@/components/Navbar";
import MarketCategories from "@/components/MarketCategories";

const fmtIdx = (v: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);

interface IndexTick { label: string; value: number; change: number; changePct: number }

const IDX_LIST = [
  { label: "NIFTY 50",   ticker: "^NSEI" },
  { label: "SENSEX",     ticker: "^BSESN" },
  { label: "BANK NIFTY", ticker: "^NSEBANK" },
];

function useIndices() {
  const [data, setData] = useState<IndexTick[]>([]);
  const baselineRef = useRef<Record<string, number>>({});

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.getMultiPrice(IDX_LIST.map((i) => i.ticker));
      const result: IndexTick[] = [];
      for (const idx of IDX_LIST) {
        const entry = res.prices[idx.ticker];
        if (!entry?.price) continue;
        if (!baselineRef.current[idx.ticker]) baselineRef.current[idx.ticker] = entry.price;
        const baseline = baselineRef.current[idx.ticker];
        const change = entry.price - baseline;
        result.push({ label: idx.label, value: entry.price, change, changePct: (change / baseline) * 100 });
      }
      if (result.length) setData(result);
    } catch { /* silently ignore */ }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 60000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return data;
}

export default function LandingPage() {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const indices = useIndices();

  useEffect(() => {
    if (isSignedIn) router.replace("/dashboard");
  }, [isSignedIn, router]);

  if (isSignedIn) return null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <Navbar />

      <main className="flex-1 flex flex-col pt-14">
        {/* Hero */}
        <section className="flex flex-col items-center justify-center px-6 py-20 md:py-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1
              className="font-black tracking-tight mb-4 leading-none"
              style={{
                fontFamily: "var(--font-geist-mono)",
                fontSize: "clamp(3rem, 10vw, 7rem)",
                color: "var(--accent)",
              }}
            >
              TRADIO
            </h1>

            <p
              className="text-lg md:text-xl font-semibold mb-3"
              style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}
            >
              Practice Trading. Zero Risk.
            </p>

            <p className="text-sm max-w-md mb-10 mx-auto" style={{ color: "var(--muted)" }}>
              ₹1,00,000 virtual balance · Real NSE live prices · Full trading terminal
            </p>

            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Link
                href="/sign-up"
                className="text-sm font-bold px-6 py-3 shimmer-btn"
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
                className="text-sm font-semibold px-6 py-3"
                style={{
                  color: "var(--muted)",
                  border: "1px solid var(--border-2)",
                  fontFamily: "var(--font-geist-mono)",
                  letterSpacing: "0.06em",
                  borderRadius: "2px",
                }}
              >
                _SIGN_IN
              </Link>
            </div>
          </motion.div>
        </section>

        {/* Live index strip */}
        {indices.length > 0 && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="border-t border-b py-3 px-6"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <div className="flex flex-wrap justify-center gap-6 md:gap-10">
              {indices.map((idx) => {
                const isUp = idx.change >= 0;
                return (
                  <div key={idx.label} className="flex items-center gap-2">
                    <span className="text-xs font-semibold tracking-wider" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
                      {idx.label}
                    </span>
                    <span className="text-sm font-bold" style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}>
                      {fmtIdx(idx.value)}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: isUp ? "var(--up)" : "var(--down)", fontFamily: "var(--font-geist-mono)" }}>
                      {isUp ? "▲" : "▼"} {Math.abs(idx.changePct).toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.section>
        )}

        {/* Market overview */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="px-4 md:px-8 py-8 w-full max-w-5xl mx-auto"
        >
          <div
            className="text-xs font-semibold tracking-widest mb-4"
            style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
          >
            MARKET_OVERVIEW
          </div>
          <MarketCategories />
        </motion.section>

        {/* AI Coach marquee section */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.4 }}
          className="px-4 md:px-8 py-12 border-t w-full max-w-5xl mx-auto"
          style={{ borderColor: "var(--border)" }}
        >
          {/* Label */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className="text-xs font-bold tracking-widest px-2 py-0.5"
              style={{
                fontFamily: "var(--font-geist-mono)",
                color: "var(--accent)",
                border: "1px solid var(--accent)",
                borderRadius: "2px",
                letterSpacing: "0.1em",
              }}
            >
              AI COACH
            </span>
          </div>

          <div className="flex flex-col md:flex-row gap-8 items-start">
            {/* Left: copy */}
            <div className="flex-1">
              <h2
                className="font-black mb-3 leading-tight"
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  fontSize: "clamp(1.4rem, 4vw, 2.2rem)",
                  color: "var(--text)",
                }}
              >
                Your personal AI trading coach,<br />
                <span style={{ color: "var(--accent)" }}>before every trade.</span>
              </h2>
              <p className="text-sm mb-6" style={{ color: "var(--muted)", lineHeight: 1.7, maxWidth: "420px" }}>
                Before you execute, the AI Coach analyses your full portfolio, real NSE fundamentals,
                52-week price levels, and live volume — then gives you honest, specific advice in seconds.
              </p>

              {/* 3 pillars */}
              <div className="flex flex-col gap-2">
                {[
                  { icon: "◈", label: "PORTFOLIO ASSESSMENT", desc: "Sector concentration, P&L, and cash deployment reviewed every time" },
                  { icon: "◉", label: "REAL FUNDAMENTALS",    desc: "Live EPS growth, revenue, margins, and recent news — not training data" },
                  { icon: "◎", label: "PRE-TRADE REVIEW",     desc: "Advice arrives before you execute — not after it's too late" },
                ].map(({ icon, label, desc }) => (
                  <div key={label} className="flex items-start gap-3">
                    <span style={{ color: "var(--accent)", fontFamily: "var(--font-geist-mono)", fontSize: "14px", marginTop: "1px" }}>{icon}</span>
                    <div>
                      <div className="text-xs font-bold" style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.06em" }}>{label}</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: sample feedback card */}
            <div className="w-full md:w-80 flex-shrink-0">
              <div
                className="text-xs mb-2 flex items-center justify-between"
                style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}
              >
                <span>_AI_COACH</span>
                <span style={{ color: "var(--text-dim)" }}>PREVIEW</span>
              </div>
              <div
                className="p-4"
                style={{
                  border: "1px solid #f59e0b",
                  borderLeft: "3px solid #f59e0b",
                  borderRadius: "2px",
                  background: "var(--surface)",
                }}
              >
                <p
                  className="text-xs leading-relaxed mb-3"
                  style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}
                >
                  Your FMCG exposure is already at 78% — adding Sun Pharma here increases
                  sector concentration further. The stock is near its 52-week high on 2.4x
                  average volume; momentum entries at resistance rarely hold.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: "#f59e0b", fontFamily: "var(--font-geist-mono)" }}>⚠ NOTE</span>
                  <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}>52w HIGH · 2.4x VOL</span>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <div
                  className="flex-1 py-2 text-center text-xs font-black"
                  style={{
                    background: "var(--up)",
                    color: "var(--bg)",
                    fontFamily: "var(--font-geist-mono)",
                    letterSpacing: "0.06em",
                    borderRadius: "2px",
                  }}
                >
                  EXECUTE BUY →
                </div>
                <div
                  className="py-2 px-4 text-xs"
                  style={{
                    border: "1px solid var(--border)",
                    color: "var(--text-dim)",
                    fontFamily: "var(--font-geist-mono)",
                    borderRadius: "2px",
                  }}
                >
                  CANCEL
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Feature strip */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="px-4 md:px-8 py-8 border-t w-full max-w-5xl mx-auto"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {[
              { label: "AI_COACH",  value: "PRE-TRADE", desc: "AI analysis before every trade — not after" },
              { label: "BALANCE",   value: "₹1,00,000", desc: "Virtual balance to start trading immediately" },
              { label: "DATA",      value: "LIVE NSE",  desc: "Real-time NSE market prices" },
              { label: "RISK",      value: "ZERO",      desc: "Paper trading — learn without real money" },
            ].map((f) => (
              <div
                key={f.label}
                className="px-4 py-4"
                style={{
                  border: `1px solid ${f.label === "AI_COACH" ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "2px",
                  background: "var(--surface)",
                }}
              >
                <div className="text-xs mb-2" style={{ color: f.label === "AI_COACH" ? "var(--accent)" : "var(--muted)", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.08em" }}>
                  {f.label}
                </div>
                <div className="text-2xl font-black mb-1" style={{ color: "var(--accent)", fontFamily: "var(--font-geist-mono)" }}>
                  {f.value}
                </div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </motion.section>


      </main>
    </div>
  );
}
