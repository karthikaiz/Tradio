"use client";

import { useState, useEffect, useCallback } from "react";
import { api, PriceEntry } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";
import { getTickerName } from "@/lib/ticker-names";
import { usePriceStream } from "@/lib/price-stream";
import StockRow from "./StockRow";

interface StockMeta { ticker: string; name?: string }

interface Props {
  selectedTicker?: string;
}

export default function StockList({ selectedTicker }: Props) {
  const { watchlist, removeFromWatchlist } = useTrading();
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState("");

  // One-time REST fetch for immediate display on mount / watchlist change
  const fetchPrices = useCallback(async () => {
    if (watchlist.length === 0) return;
    try {
      const data = await api.getMultiPrice(watchlist);
      setPrices(data.prices);
      setLastUpdated(
        new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
    } catch {
      // keep last prices
    }
  }, [watchlist]);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  // Real-time updates via SmartWebSocket → SSE
  const streamPrices = usePriceStream(watchlist);

  useEffect(() => {
    if (Object.keys(streamPrices).length === 0) return;
    setPrices((prev) => {
      const newPrev: Record<string, number> = { ...prevPrices };
      const merged: Record<string, PriceEntry> = { ...prev };
      Object.entries(streamPrices).forEach(([ticker, sp]) => {
        if (prev[ticker]?.price != null) {
          newPrev[ticker] = prev[ticker].price as number;
        }
        merged[ticker] = { price: sp.price, as_of: new Date().toISOString(), error: null };
      });
      setPrevPrices(newPrev);
      return merged;
    });
    setLastUpdated(
      new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    );
  }, [streamPrices]); // eslint-disable-line react-hooks/exhaustive-deps

  const stocks: StockMeta[] = watchlist.map((t) => ({ ticker: t, name: getTickerName(t) }));

  if (stocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
        <div
          className="text-xs font-mono mb-2"
          style={{ color: "var(--text-dim)", letterSpacing: "0.08em" }}
        >
          WATCHLIST EMPTY
        </div>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Search for a stock in the top bar to add it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="overflow-x-auto flex-1">
        <table className="w-full" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "48%" }} />
            <col style={{ width: "25%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "5%" }} />
          </colgroup>
          <thead>
            <tr
              className="border-b"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface)",
                position: "sticky",
                top: 0,
                zIndex: 1,
              }}
            >
              {["STOCK", "PRICE", "CHG%", ""].map((h) => (
                <th
                  key={h}
                  className={`py-3 px-4 text-xs font-semibold tracking-widest ${h === "" ? "" : h === "STOCK" ? "text-left" : "text-right"}`}
                  style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
                >
                  {h}
                </th>
              ))}
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
                selected={selectedTicker === s.ticker}
              />
            ))}
          </tbody>
        </table>
      </div>

      {lastUpdated && (
        <div
          className="px-4 py-1.5 border-t flex items-center gap-2 flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="live-dot" />
          <span
            className="text-xs"
            style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}
          >
            {lastUpdated}
          </span>
        </div>
      )}
    </div>
  );
}
