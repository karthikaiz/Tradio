"use client";

import { useState, useEffect, useRef } from "react";
import { api, CategoryStock } from "@/lib/api";

const INDICES = [
  { name: "NIFTY 50", ticker: "^NSEI" },
  { name: "SENSEX", ticker: "^BSESN" },
];

const DEFAULT_STOCKS = [
  "RELIANCE", "TCS", "INFY", "HDFCBANK", "SBIN",
  "WIPRO", "ICICIBANK", "KOTAKBANK", "BAJFINANCE", "ZOMATO",
];

interface TapeItem {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
}

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(v);

export default function TickerTape() {
  const [items, setItems] = useState<TapeItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const load = async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const data = await api.getCategories(abortRef.current.signal);
        if (abortRef.current.signal.aborted) return;
        // Merge all categories, dedupe by ticker, take 14
        const all: CategoryStock[] = [
          ...data.gainers,
          ...data.losers,
          ...data.active,
        ];
        const seen = new Set<string>();
        const unique: TapeItem[] = [];
        for (const s of all) {
          if (!seen.has(s.ticker)) {
            seen.add(s.ticker);
            unique.push({ ticker: s.ticker, name: s.name, price: s.price, change_pct: s.change_pct });
          }
          if (unique.length >= 14) break;
        }
        setItems(unique);
      } catch {
        // silently use whatever was loaded before
      }
    };

    load();
    const interval = setInterval(load, 90000);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, []);

  if (items.length === 0) return null;

  // Duplicate for seamless loop
  const doubled = [...items, ...items];

  return (
    <div
      className="w-full overflow-hidden border-b"
      style={{
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
        borderColor: "var(--border)",
        height: "32px",
        position: "relative",
        zIndex: 1,
      }}
    >
      <div className="ticker-track h-full items-center">
        {doubled.map((item, i) => {
          const isUp = item.change_pct >= 0;
          return (
            <span
              key={`${item.ticker}-${i}`}
              className="inline-flex items-center gap-2 px-4 text-xs tabular"
              style={{ height: "32px" }}
            >
              <span className="font-bold tracking-wide" style={{ color: "var(--text)" }}>
                {item.ticker}
              </span>
              <span style={{ color: "var(--muted)" }}>{formatINR(item.price)}</span>
              <span
                className="font-semibold"
                style={{ color: isUp ? "var(--up)" : "var(--down)" }}
              >
                {isUp ? "▲" : "▼"} {Math.abs(item.change_pct).toFixed(2)}%
              </span>
              <span style={{ color: "var(--border-2)", marginLeft: "4px" }}>·</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
