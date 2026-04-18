"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";

interface Props {
  showWatchButton?: boolean;
  placeholder?: string;
}

export default function SearchBox({ showWatchButton = false, placeholder = "Search stocks — e.g. RELIANCE, TCS, INFY" }: Props) {
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
        setResults(r.slice(0, 8));
      } catch { /* */ }
      finally { setLoading(false); }
    }, 300);
  }, [query]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false); setQuery(""); setResults([]);
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
    <div ref={wrapRef} className="relative w-full">
      {/* Input */}
      <div
        className="flex items-center gap-3 px-4 w-full transition-all"
        style={{
          height: "52px",
          background: "var(--surface)",
          border: `1px solid ${focused ? "var(--accent)" : "var(--border-2)"}`,
          borderRadius: "4px",
          boxShadow: focused ? "0 0 0 2px var(--accent-dim)" : "none",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ color: focused ? "var(--accent)" : "var(--muted)", flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent focus:outline-none text-sm"
          style={{
            fontFamily: "var(--font-geist-mono)",
            color: "var(--text)",
            letterSpacing: "0.02em",
          }}
        />
        {loading && (
          <span className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>···</span>
        )}
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); }}
            className="text-xs flex-shrink-0"
            style={{ color: "var(--muted)" }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {focused && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 z-50 mt-1 overflow-hidden"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-2)",
              borderRadius: "4px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
            }}
          >
            {results.map((r, i) => (
              <div
                key={r.ticker}
                onMouseDown={(e) => { e.preventDefault(); select(r.ticker); }}
                className="flex items-center justify-between px-4 py-3 cursor-pointer"
                style={{
                  borderBottom: i < results.length - 1 ? "1px solid var(--border)" : "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div className="min-w-0 flex flex-col">
                  <span className="font-bold text-sm" style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}>
                    {r.name || r.ticker}
                  </span>
                  <span className="text-xs mt-0.5" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}>
                    {r.ticker}
                  </span>
                </div>

                {showWatchButton && (
                  <button
                    onMouseDown={(e) => {
                      e.stopPropagation(); e.preventDefault();
                      addToWatchlist(r.ticker);
                      setQuery(""); setResults([]); setFocused(false);
                    }}
                    className="ml-4 flex-shrink-0 text-xs px-2 py-1 transition-colors"
                    style={{
                      color: "var(--accent)",
                      border: "1px solid var(--accent-dim)",
                      borderRadius: "2px",
                      fontFamily: "var(--font-geist-mono)",
                      letterSpacing: "0.04em",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "var(--accent-dim)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    + WATCH
                  </button>
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
