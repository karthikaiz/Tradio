"use client";

import { useState, useEffect, useRef } from "react";
import { api, ApiError, SearchResult } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";

export default function MarketWatch() {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setSelected, selectedTicker } = useTrading();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const priceAbortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchPrice = async (ticker: string) => {
    if (!ticker.trim()) {
      setPrice(null);
      setError(null);
      return;
    }

    if (priceAbortRef.current) priceAbortRef.current.abort();
    priceAbortRef.current = new AbortController();
    const signal = priceAbortRef.current.signal;

    setLoading(true);
    setError(null);
    try {
      const data = await api.getPrice(ticker.trim().toUpperCase(), signal);
      if (signal.aborted) return;
      setPrice(data.price);
      setAsOf(data.as_of);
    } catch (e) {
      if (signal.aborted) return;
      setPrice(null);
      setAsOf(null);
      if (e instanceof ApiError) {
        setError(e.detail?.reason as string || e.message);
      } else {
        setError("Unable to fetch price");
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  // Debounced search for suggestions + price
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!input.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      setPrice(null);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      searchAbortRef.current = new AbortController();
      const signal = searchAbortRef.current.signal;

      try {
        const { results } = await api.searchTickers(input, signal);
        if (signal.aborted) return;
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch {
        // Search errors are silent
      }

      // Only attempt price fetch if input looks like a ticker (no spaces, letters/digits/- only)
      const looksLikeTicker = /^[A-Za-z0-9\-&]+$/.test(input.trim());
      if (looksLikeTicker) {
        fetchPrice(input);
      } else {
        setPrice(null);
        setError(null);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input]);

  // Poll every 3 seconds while a ticker is displayed
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const ticker = input.trim();
    if (!ticker || !/^[A-Za-z0-9\-&]+$/.test(ticker)) return;
    pollRef.current = setInterval(() => {
      fetchPrice(ticker);
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [input]);

  const selectSuggestion = (s: SearchResult) => {
    setInput(s.ticker);
    setSuggestions([]);
    setShowSuggestions(false);
    fetchPrice(s.ticker);
  };

  const handleSelect = () => {
    if (input && price !== null) {
      setSelected(input.toUpperCase(), price);
    }
  };

  const formatINR = (value: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 h-full flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
        Market Watch
      </h2>

      {/* Search input + dropdown */}
      <div ref={containerRef} className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          placeholder="Ticker (e.g. RELIANCE) or company name"
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors"
        />

        {/* Autocomplete dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-lg bg-gray-800 border border-gray-700 shadow-xl overflow-hidden">
            {suggestions.map((s) => (
              <li key={`${s.ticker}-${s.exchange}`}>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent input blur before click
                    selectSuggestion(s);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-gray-700 transition-colors flex items-center justify-between gap-2"
                >
                  <span className="text-white text-sm font-medium">{s.ticker}</span>
                  <span className="text-gray-400 text-xs truncate flex-1">{s.name}</span>
                  <span className="text-gray-600 text-xs flex-shrink-0">{s.exchange}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="animate-pulse space-y-2">
          <div className="h-8 bg-gray-800 rounded w-2/3" />
          <div className="h-4 bg-gray-800 rounded w-1/3" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg bg-red-950 border border-red-800 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Price result */}
      {!loading && !error && price !== null && input && (
        <button
          onClick={handleSelect}
          className={`w-full rounded-lg border px-4 py-3 text-left transition-colors cursor-pointer ${
            selectedTicker === input.toUpperCase()
              ? "border-green-500 bg-green-950"
              : "border-gray-700 bg-gray-800 hover:border-green-600"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-white">{input.toUpperCase()}</span>
            {selectedTicker === input.toUpperCase() && (
              <span className="text-xs text-green-400">Selected</span>
            )}
          </div>
          <div className="text-2xl font-semibold text-green-400 mt-1">
            {formatINR(price)}
          </div>
          {asOf && (
            <div className="text-xs text-gray-500 mt-1">as of {formatTime(asOf)}</div>
          )}
        </button>
      )}

      {/* Hint */}
      {!loading && !error && !price && !input && (
        <div className="text-xs text-gray-600 space-y-1">
          <p>Type a ticker (e.g. <span className="text-gray-500">RELIANCE</span>, <span className="text-gray-500">TCS</span>) or at least 2 words of a company name.</p>
          <p className="text-gray-700">Tip: "Tata Consult" works; "Tata" alone may not.</p>
        </div>
      )}
    </div>
  );
}
