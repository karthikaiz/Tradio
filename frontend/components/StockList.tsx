"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { api, PriceEntry } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";
import StockRow from "./StockRow";
import LiveDot from "./ui/LiveDot";

interface StockMeta {
  ticker: string;
  name?: string;
}

const TICKER_NAMES: Record<string, string> = {
  RELIANCE: "Reliance Industries",
  TCS: "Tata Consultancy Services",
  INFY: "Infosys",
  HDFCBANK: "HDFC Bank",
  SBIN: "State Bank of India",
  WIPRO: "Wipro",
  ICICIBANK: "ICICI Bank",
  AXISBANK: "Axis Bank",
  KOTAKBANK: "Kotak Mahindra Bank",
  BAJFINANCE: "Bajaj Finance",
  SWIGGY: "Swiggy",
  ZOMATO: "Zomato",
};

export default function StockList() {
  const { watchlist, addToWatchlist, removeFromWatchlist } = useTrading();
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ ticker: string; name: string }[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [focused, setFocused] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const fetchPrices = useCallback(async () => {
    if (watchlist.length === 0) return;
    try {
      const data = await api.getMultiPrice(watchlist);
      setPrices((prev) => {
        const newPrev: Record<string, number> = { ...prevPrices };
        Object.entries(data.prices).forEach(([ticker, entry]) => {
          if (entry.price !== null && prev[ticker]?.price !== null && prev[ticker]?.price !== undefined) {
            newPrev[ticker] = prev[ticker].price as number;
          }
        });
        setPrevPrices(newPrev);
        return data.prices;
      });
      setLastUpdated(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch {
      // silent — keep showing last prices
    }
  }, [watchlist]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      searchAbortRef.current = new AbortController();
      try {
        const { results } = await api.searchTickers(searchQuery, searchAbortRef.current.signal);
        setSearchResults(results.slice(0, 6));
      } catch { /* aborted or error */ }
    }, 350);
  }, [searchQuery]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
        setSearchQuery("");
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleAddTicker = (ticker: string) => {
    addToWatchlist(ticker);
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults([]);
    setFocused(false);
  };

  const stocks: StockMeta[] = watchlist.map((t) => ({
    ticker: t,
    name: TICKER_NAMES[t],
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div ref={searchRef} className="relative px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div
          className="relative flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
          style={{
            background: "var(--surface-2)",
            border: `1px solid ${focused ? "rgba(91,139,255,0.5)" : "var(--border)"}`,
            boxShadow: focused ? "0 0 0 3px rgba(91,139,255,0.1)" : "none",
          }}
        >
          <span style={{ color: "var(--muted)" }}>⌕</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setShowSearch(true); }}
            onFocus={() => { setShowSearch(true); setFocused(true); }}
            placeholder="Search stocks..."
            className="flex-1 text-sm bg-transparent focus:outline-none"
            style={{ color: "var(--text)" }}
          />
        </div>

        {showSearch && searchResults.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute z-20 top-full left-4 right-4 rounded-xl overflow-hidden mt-1"
            style={{
              background: "rgba(7,11,20,0.95)",
              backdropFilter: "blur(20px)",
              border: "1px solid var(--border)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
            }}
          >
            {searchResults.map((r) => (
              <li key={r.ticker}>
                <button
                  onMouseDown={(e) => { e.preventDefault(); handleAddTicker(r.ticker); }}
                  className="w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 transition-colors"
                  style={{ color: "var(--text)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span className="font-bold text-sm tracking-wide">{r.ticker}</span>
                  <span className="text-xs flex-1 truncate" style={{ color: "var(--muted)" }}>{r.name}</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>+ Add</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr
              className="text-xs font-semibold uppercase tracking-wider border-b"
              style={{ color: "var(--muted)", borderColor: "var(--border)" }}
            >
              <th className="py-2 px-4 text-left">Ticker</th>
              <th className="py-2 px-4 text-right">LTP</th>
              <th className="py-2 px-4 text-right">Chg</th>
              <th className="py-2 px-4 text-right">%Chg</th>
              <th className="py-2 px-4 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s, i) => (
              <StockRow
                key={s.ticker}
                ticker={s.ticker}
                name={s.name}
                price={prices[s.ticker]?.price ?? null}
                prevPrice={prevPrices[s.ticker] ?? null}
                error={prices[s.ticker]?.error ?? null}
                onRemove={() => removeFromWatchlist(s.ticker)}
                index={i}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {lastUpdated && (
        <div className="px-4 py-2 border-t flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
          <LiveDot />
          <span className="text-xs" style={{ color: "var(--muted)" }}>Updated {lastUpdated}</span>
        </div>
      )}
    </div>
  );
}
