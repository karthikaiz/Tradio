"use client";

import { useEffect, useRef, useState } from "react";

export interface StreamPrice {
  ticker: string;
  price: number;
  change_pct: number;
}

// Connect directly to backend to avoid Next.js proxy buffering SSE
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function usePriceStream(tickers: string[]): Record<string, StreamPrice> {
  const [prices, setPrices] = useState<Record<string, StreamPrice>>({});
  const esRef = useRef<EventSource | null>(null);
  // Stable string key so effect only re-runs when the ticker list actually changes
  const tickersKey = [...tickers].sort().join(",");

  useEffect(() => {
    if (tickers.length === 0) return;

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const url = `${BACKEND_URL}/api/stream/prices?tickers=${encodeURIComponent(tickers.join(","))}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as
          | { prices: Record<string, StreamPrice> }
          | StreamPrice;

        if ("prices" in data) {
          // Initial snapshot with multiple tickers
          setPrices((prev) => ({ ...prev, ...data.prices }));
        } else if ("ticker" in data) {
          // Single tick update
          setPrices((prev) => ({ ...prev, [data.ticker]: data }));
        }
      } catch {
        // ignore parse errors
      }
    };

    // EventSource auto-reconnects on error; no explicit handling needed
    es.onerror = () => {};

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [tickersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return prices;
}
