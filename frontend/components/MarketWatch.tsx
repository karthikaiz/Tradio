"use client";

import { useState, useEffect, useRef } from "react";
import { api, ApiError } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";

export default function MarketWatch() {
  const [input, setInput] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setSelected, selectedTicker } = useTrading();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPrice = async (ticker: string) => {
    if (!ticker.trim()) {
      setPrice(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getPrice(ticker.trim().toUpperCase());
      setPrice(data.price);
      setAsOf(data.as_of);
    } catch (e) {
      setPrice(null);
      setAsOf(null);
      if (e instanceof ApiError) {
        setError(e.detail?.reason as string || e.message);
      } else {
        setError("Unable to fetch price");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchPrice(input);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input]);

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

      {/* Search input */}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value.toUpperCase())}
        placeholder="Search ticker e.g. RELIANCE"
        className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors"
      />

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
        <p className="text-xs text-gray-600">
          Type a NSE ticker symbol to see the current price. Click the result to select it for trading.
        </p>
      )}
    </div>
  );
}
