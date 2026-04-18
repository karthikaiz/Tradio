"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";
import AnimatedNumber from "./ui/AnimatedNumber";

const fmtIdx = (v: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);

const fmtBal = (v: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);

interface IndexData { value: number; change: number; changePct: number }

const INDICES = [
  { label: "NIFTY 50", ticker: "^NSEI" },
  { label: "SENSEX",   ticker: "^BSESN" },
  { label: "BANK NIFTY", ticker: "^NSEBANK" },
];

function useIndices() {
  const [data, setData] = useState<Record<string, IndexData>>({});
  const baselineRef = useRef<Record<string, number>>({});

  const fetch = useCallback(async () => {
    try {
      const tickers = INDICES.map((i) => i.ticker);
      const res = await api.getMultiPrice(tickers);
      const updated: Record<string, IndexData> = {};
      for (const idx of INDICES) {
        const entry = res.prices[idx.ticker];
        if (!entry?.price) continue;
        if (!baselineRef.current[idx.ticker]) baselineRef.current[idx.ticker] = entry.price;
        const baseline = baselineRef.current[idx.ticker];
        const change = entry.price - baseline;
        updated[idx.ticker] = { value: entry.price, change, changePct: (change / baseline) * 100 };
      }
      if (Object.keys(updated).length) setData((prev) => ({ ...prev, ...updated }));
    } catch {
      // silently ignore — indices might not be supported
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 60000);
    return () => clearInterval(id);
  }, [fetch]);

  return data;
}

function SearchBar() {
  const router = useRouter();
  const { addToWatchlist } = useTrading();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ ticker: string; name: string }[]>([]);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!query.trim() || query.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const { results: r } = await api.searchTickers(query, abortRef.current.signal);
        setResults(r.slice(0, 7));
      } catch { /* */ }
      finally { setLoading(false); }
    }, 300);
  }, [query]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false); setResults([]); setQuery("");
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const select = (ticker: string) => {
    router.push(`/stock/${ticker}`);
    setQuery(""); setResults([]); setFocused(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div
        className="flex items-center gap-2 px-3"
        style={{
          height: "30px",
          width: "200px",
          background: "var(--bg)",
          border: `1px solid ${focused ? "var(--accent)" : "var(--border-2)"}`,
          borderRadius: "2px",
          transition: "border-color 0.15s",
        }}
      >
        <span
          style={{ color: "var(--accent)", fontSize: "12px", fontFamily: "var(--font-geist-mono)", lineHeight: 1 }}
        >›</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="TICKER OR COMMAND"
          className="flex-1 bg-transparent focus:outline-none"
          style={{
            fontSize: "11px",
            fontFamily: "var(--font-geist-mono)",
            color: "var(--text)",
            letterSpacing: "0.05em",
          }}
        />
        {loading && (
          <span style={{ color: "var(--muted)", fontSize: "10px", fontFamily: "var(--font-geist-mono)" }}>...</span>
        )}
      </div>

      <AnimatePresence>
        {focused && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full left-0 z-50 mt-1 overflow-hidden"
            style={{
              width: "280px",
              background: "var(--surface)",
              border: "1px solid var(--border-2)",
              borderRadius: "2px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            {results.map((r) => (
              <div
                key={r.ticker}
                onMouseDown={(e) => { e.preventDefault(); select(r.ticker); }}
                className="flex items-center justify-between px-3 py-2 cursor-pointer group"
                style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div className="min-w-0">
                  <span
                    className="font-bold text-xs"
                    style={{ color: "var(--accent)", fontFamily: "var(--font-geist-mono)" }}
                  >
                    {r.ticker}
                  </span>
                  <span className="text-xs ml-2 truncate" style={{ color: "var(--muted)" }}>{r.name}</span>
                </div>
                <button
                  onMouseDown={(e) => {
                    e.stopPropagation(); e.preventDefault();
                    addToWatchlist(r.ticker);
                    setQuery(""); setResults([]); setFocused(false);
                  }}
                  className="ml-2 flex-shrink-0 text-xs px-1.5 py-0.5 transition-colors"
                  style={{
                    color: "var(--accent)",
                    border: "1px solid var(--accent-dim)",
                    borderRadius: "2px",
                    fontFamily: "var(--font-geist-mono)",
                  }}
                >
                  +WATCH
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Navbar() {
  const { isSignedIn, user, signOut } = useAuth();
  const { portfolio } = useTrading();
  const indices = useIndices();

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center px-4 gap-4"
      style={{
        height: "56px",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        fontFamily: "var(--font-geist-mono)",
      }}
    >
      {/* Logo */}
      <Link href={isSignedIn ? "/dashboard" : "/"} className="flex-shrink-0 mr-2">
        <span
          className="font-black tracking-widest text-sm"
          style={{ color: "var(--accent)" }}
        >
          TR
        </span>
      </Link>

      {/* Indices — desktop only */}
      <div className="hidden md:flex items-center gap-5 flex-1 min-w-0">
        {INDICES.map((idx) => {
          const d = indices[idx.ticker];
          const isUp = !d || d.change >= 0;
          return (
            <div key={idx.ticker} className="flex items-center gap-1.5 flex-shrink-0">
              <span
                className="text-xs font-semibold tracking-wider"
                style={{ color: "var(--muted)" }}
              >
                {idx.label}
              </span>
              {d ? (
                <>
                  <AnimatedNumber
                    value={d.value}
                    format={fmtIdx}
                    className="text-xs font-semibold"
                    style={{ color: "var(--text)" }}
                  />
                  <span className="text-xs font-semibold" style={{ color: isUp ? "var(--up)" : "var(--down)" }}>
                    {isUp ? "▲" : "▼"} {Math.abs(d.changePct).toFixed(2)}%
                  </span>
                </>
              ) : (
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>—</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Search — desktop only */}
      <div className="hidden md:block ml-auto mr-2">
        <SearchBar />
      </div>

      {/* Auth */}
      <div className="flex items-center gap-2 ml-auto md:ml-0 flex-shrink-0">
        {isSignedIn ? (
          <>
            {portfolio && (
              <div
                className="hidden sm:flex items-center gap-1 px-2 py-1"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border-2)",
                  borderRadius: "2px",
                  fontSize: "11px",
                }}
              >
                <span style={{ color: "var(--muted)" }}>₹</span>
                <AnimatedNumber
                  value={portfolio.available_balance}
                  format={fmtBal}
                  style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)", fontWeight: 600 }}
                />
              </div>
            )}
            <button
              onClick={signOut}
              className="text-xs font-semibold px-2 py-1 transition-opacity hover:opacity-70"
              style={{
                color: "var(--muted)",
                border: "1px solid var(--border-2)",
                borderRadius: "2px",
                fontFamily: "var(--font-geist-mono)",
                letterSpacing: "0.05em",
                background: "transparent",
                cursor: "pointer",
              }}
              title={user?.email ?? ""}
            >
              {user?.email?.split("@")[0]?.toUpperCase() ?? "SIGN_OUT"}
            </button>
          </>
        ) : (
          <Link
            href="/sign-in"
            className="text-xs font-bold px-3 py-1.5 transition-opacity hover:opacity-80"
            style={{
              color: "var(--accent-text)",
              background: "var(--accent)",
              borderRadius: "2px",
              fontFamily: "var(--font-geist-mono)",
              letterSpacing: "0.05em",
            }}
          >
            _SIGN_IN
          </Link>
        )}
      </div>
    </header>
  );
}
