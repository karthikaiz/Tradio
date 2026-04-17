"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@clerk/nextjs";
import { useTrading } from "@/lib/trading-context";
import { api } from "@/lib/api";
import Navbar from "@/components/Navbar";
import StockList from "@/components/StockList";
import PortfolioPanel from "@/components/PortfolioPanel";
import MarketCategories from "@/components/MarketCategories";
import PageTransition from "@/components/ui/PageTransition";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import LiveDot from "@/components/ui/LiveDot";

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

function StockSearchBar() {
  const router = useRouter();
  const { addToWatchlist } = useTrading();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ ticker: string; name: string }[]>([]);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const { results: r } = await api.searchTickers(query, abortRef.current.signal);
        setResults(r.slice(0, 7));
      } catch { /* aborted */ }
      finally { setLoading(false); }
    }, 300);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setFocused(false);
        setResults([]);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (ticker: string) => {
    setQuery("");
    setResults([]);
    setFocused(false);
    router.push(`/stock/${ticker}`);
  };

  const showDropdown = focused && query.length >= 2;

  return (
    <div ref={wrapperRef} className="relative w-full">
      <motion.div
        animate={{ boxShadow: focused ? "0 0 0 3px var(--accent-glow)" : "0 2px 8px rgba(0,0,0,0.06)" }}
        transition={{ duration: 0.15 }}
        className="flex items-center gap-3 px-4 py-3 rounded-2xl"
        style={{
          background: "var(--surface)",
          border: `1.5px solid ${focused ? "var(--accent)" : "var(--border-2)"}`,
        }}
      >
        {/* Search icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: focused ? "var(--accent)" : "var(--muted)", flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Search any stock — e.g. RELIANCE, TCS, ZOMATO…"
          className="flex-1 text-sm bg-transparent focus:outline-none font-medium"
          style={{ color: "var(--text)" }}
        />
        {loading && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
            className="w-4 h-4 border-2 rounded-full flex-shrink-0"
            style={{ borderColor: "var(--border-2)", borderTopColor: "var(--accent)" }}
          />
        )}
        {!loading && (
          <span
            className="text-xs px-2 py-0.5 rounded-md font-semibold flex-shrink-0"
            style={{ background: "var(--accent)", color: "var(--accent-text)", opacity: 0.85 }}
          >
            Search
          </span>
        )}
      </motion.div>

      {/* Dropdown */}
      <AnimatePresence>
        {showDropdown && results.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute z-30 top-full left-0 right-0 mt-2 rounded-2xl overflow-hidden"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border-2)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.12)",
            }}
          >
            {results.map((r, i) => (
              <li key={r.ticker}>
                <div
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(r.ticker); }}
                  className="w-full px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer"
                  style={{ borderBottom: i < results.length - 1 ? "1px solid var(--border)" : "none" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0"
                    style={{ background: "var(--surface-2)", color: "var(--accent)" }}
                  >
                    {r.ticker.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold" style={{ color: "var(--text)" }}>{r.name}</div>
                    <div className="text-xs font-semibold tracking-wide" style={{ color: "var(--muted)" }}>{r.ticker}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); addToWatchlist(r.ticker); setQuery(""); setResults([]); setFocused(false); }}
                      className="text-xs px-2 py-1 rounded-lg font-semibold border transition-colors"
                      style={{ color: "var(--muted)", borderColor: "var(--border-2)" }}
                    >
                      + Watch
                    </button>
                    <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>View →</span>
                  </div>
                </div>
              </li>
            ))}
          </motion.ul>
        )}
        {showDropdown && !loading && results.length === 0 && query.length >= 2 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute z-30 top-full left-0 right-0 mt-2 rounded-2xl px-4 py-4 text-sm text-center"
            style={{ background: "var(--bg)", border: "1px solid var(--border-2)", color: "var(--muted)" }}
          >
            No stocks found for &quot;{query}&quot;
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function DashboardPage() {
  const { refreshPortfolio, portfolio } = useTrading();

  useEffect(() => {
    refreshPortfolio();
  }, [refreshPortfolio]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <Navbar />

      <PageTransition className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
        {/* Top row: greeting + live */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold" style={{ color: "var(--text)" }}>Dashboard</h1>
            {portfolio && (
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs" style={{ color: "var(--muted)" }}>Portfolio value:</span>
                <AnimatedNumber
                  value={portfolio.available_balance + portfolio.total_invested}
                  format={formatINR}
                  className="text-xs font-semibold"
                  style={{ color: "var(--text)" }}
                />
                {portfolio.total_unrealized_pnl !== 0 && (
                  <span className="text-xs font-semibold" style={{ color: portfolio.total_unrealized_pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                    ({portfolio.total_unrealized_pnl >= 0 ? "▲ +" : "▼ "}{formatINR(portfolio.total_unrealized_pnl)})
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <LiveDot />
            <span className="text-xs" style={{ color: "var(--muted)" }}>Live</span>
          </div>
        </div>

        {/* Prominent search bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <StockSearchBar />
        </motion.div>

        {/* Market Overview — full width, always first */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Market Overview
            </h2>
            <LiveDot />
          </div>
          <MarketCategories />
        </motion.section>

        {/* Watchlist + Portfolio — side by side on desktop, stacked on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* Watchlist */}
          <motion.aside
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Watchlist
              </h2>
              <span className="text-xs" style={{ color: "var(--muted)" }}>Tap a row to trade →</span>
            </div>
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                minHeight: "200px",
              }}
            >
              <StockList />
            </div>
          </motion.aside>

          {/* Portfolio summary */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Portfolio
              </h2>
              <Link href="/portfolio" className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
                View all →
              </Link>
            </div>
            <PortfolioPanel />
          </motion.section>
        </div>
      </PageTransition>
    </div>
  );
}
