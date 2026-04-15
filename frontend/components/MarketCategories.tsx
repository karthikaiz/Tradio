"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api, CategoryStock } from "@/lib/api";
import AnimatedNumber from "./ui/AnimatedNumber";

type Category = "gainers" | "losers" | "active" | "stable";

const TABS: { label: string; value: Category }[] = [
  { label: "Top Gainers", value: "gainers" },
  { label: "Top Losers", value: "losers" },
  { label: "Most Active", value: "active" },
  { label: "Stable", value: "stable" },
];

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

export default function MarketCategories() {
  const [tab, setTab] = useState<Category>("gainers");
  const [data, setData] = useState<Record<Category, CategoryStock[]>>({
    gainers: [], losers: [], active: [], stable: [],
  });
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchData = async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const res = await api.getCategories(abortRef.current.signal);
        if (abortRef.current.signal.aborted) return;
        setData(res);
      } catch {
        // keep stale data on error
      } finally {
        if (!abortRef.current?.signal.aborted) setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, []);

  const stocks = data[tab] || [];

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--surface)",
        backdropFilter: "blur(var(--glass-blur))",
        WebkitBackdropFilter: "blur(var(--glass-blur))",
        border: "1px solid var(--border)",
      }}
    >
      {/* Tab bar with sliding pill */}
      <div className="flex border-b overflow-x-auto relative" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className="px-4 py-3 text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0 relative"
            style={{ color: tab === t.value ? "var(--text)" : "var(--muted)" }}
          >
            {tab === t.value && (
              <motion.div
                layoutId="market-tab-pill"
                className="absolute inset-x-0 bottom-0 h-0.5"
                style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-10">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="w-6 h-3 rounded animate-pulse" style={{ background: "var(--surface-2)" }} />
              <div className="flex-1 h-3 rounded animate-pulse" style={{ background: "var(--surface-2)" }} />
              <div className="w-20 h-3 rounded animate-pulse" style={{ background: "var(--surface-2)" }} />
              <div className="w-16 h-3 rounded animate-pulse" style={{ background: "var(--surface-2)" }} />
            </div>
          ))}
        </div>
      ) : stocks.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: "var(--muted)" }}>
          No data available
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs font-semibold uppercase tracking-wider border-b"
                style={{ color: "var(--muted)", borderColor: "var(--border)" }}
              >
                <th className="py-2.5 px-4 text-left">#</th>
                <th className="py-2.5 px-4 text-left">Stock</th>
                <th className="py-2.5 px-4 text-right">LTP</th>
                <th className="py-2.5 px-4 text-right">Change</th>
                <th className="py-2.5 px-4 text-right hidden sm:table-cell">Volume</th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              <motion.tbody
                key={tab}
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: {},
                  visible: { transition: { staggerChildren: 0.04 } },
                }}
              >
                {stocks.map((stock, i) => {
                  const isUp = stock.change_pct >= 0;
                  return (
                    <motion.tr
                      key={stock.ticker}
                      variants={{
                        hidden: { opacity: 0, x: -8 },
                        visible: { opacity: 1, x: 0, transition: { duration: 0.25 } },
                      }}
                      className="border-b cursor-pointer group"
                      style={{ borderColor: "var(--border)" }}
                      onClick={() => router.push(`/stock/${stock.ticker}`)}
                      whileHover={{ backgroundColor: "rgba(255,255,255,0.03)" }}
                    >
                      <td className="py-3 px-4 text-sm" style={{ color: "var(--muted)" }}>{i + 1}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-sm tracking-wide" style={{ color: "var(--text)" }}>
                          {stock.ticker}
                        </div>
                        <div className="text-xs truncate max-w-[140px]" style={{ color: "var(--muted)" }}>
                          {stock.name}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-sm">
                        <AnimatedNumber
                          value={stock.price}
                          format={formatINR}
                          style={{ color: "var(--text)" }}
                        />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold tabular"
                          style={{
                            color: isUp ? "var(--up)" : "var(--down)",
                            background: isUp ? "rgba(0,229,160,0.1)" : "rgba(255,77,109,0.1)",
                          }}
                        >
                          {isUp ? "▲" : "▼"} {Math.abs(stock.change_pct).toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-xs hidden sm:table-cell" style={{ color: "var(--muted)" }}>
                        {stock.volume > 1000000
                          ? `${(stock.volume / 1000000).toFixed(1)}M`
                          : stock.volume > 1000
                          ? `${(stock.volume / 1000).toFixed(0)}K`
                          : stock.volume}
                      </td>
                    </motion.tr>
                  );
                })}
              </motion.tbody>
            </AnimatePresence>
          </table>
        </div>
      )}
    </div>
  );
}
