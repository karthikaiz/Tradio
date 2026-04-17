"use client";

import { useState, useEffect, useCallback } from "react";
import { api, PriceEntry } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";
import { getTickerName } from "@/lib/ticker-names";
import StockRow from "./StockRow";
import LiveDot from "./ui/LiveDot";

interface StockMeta {
  ticker: string;
  name?: string;
}

export default function StockList() {
  const { watchlist, removeFromWatchlist } = useTrading();
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState<string>("");

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

  const stocks: StockMeta[] = watchlist.map((t) => ({
    ticker: t,
    name: getTickerName(t),
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr
              className="text-xs font-semibold uppercase tracking-wider border-b"
              style={{ color: "var(--muted)", borderColor: "var(--border)" }}
            >
              <th className="py-2 px-4 text-left">Stock</th>
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
