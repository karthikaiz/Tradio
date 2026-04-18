"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api, CategoryStock } from "@/lib/api";
import AnimatedNumber from "./ui/AnimatedNumber";

type Category = "gainers" | "losers" | "active" | "stable";

const TABS: { label: string; value: Category }[] = [
  { label: "TOP_GAINERS",  value: "gainers" },
  { label: "TOP_LOSERS",   value: "losers" },
  { label: "MOST_ACTIVE",  value: "active" },
  { label: "STABLE",       value: "stable" },
];

const fmtINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

const fmtVol = (v: number) =>
  v > 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
  : v > 1_000   ? `${(v / 1_000).toFixed(0)}K`
  : String(v);

export default function MarketCategories() {
  const [tab, setTab] = useState<Category>("gainers");
  const [data, setData] = useState<Record<Category, CategoryStock[]>>({ gainers: [], losers: [], active: [], stable: [] });
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  useEffect(() => {
    const load = async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const res = await api.getCategories(abortRef.current.signal);
        if (!abortRef.current.signal.aborted) setData(res);
      } catch { /* keep stale */ }
      finally { if (!abortRef.current?.signal.aborted) setLoading(false); }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { clearInterval(id); abortRef.current?.abort(); };
  }, []);

  const stocks = data[tab] ?? [];

  const thStyle: React.CSSProperties = {
    color: "var(--muted)",
    fontFamily: "var(--font-geist-mono)",
    fontSize: "10px",
    letterSpacing: "0.08em",
    fontWeight: 600,
  };

  return (
    <div
      className="overflow-hidden"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "2px",
      }}
    >
      {/* Tab bar */}
      <div className="flex border-b overflow-x-auto" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className="px-4 py-2.5 text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-colors"
            style={{
              color: tab === t.value ? "var(--accent)" : "var(--muted)",
              fontFamily: "var(--font-geist-mono)",
              letterSpacing: "0.06em",
              borderBottom: tab === t.value ? "1px solid var(--accent)" : "1px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-8">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-2.5">
              <div className="w-4 h-3 rounded-sm animate-pulse" style={{ background: "var(--surface-2)" }} />
              <div className="flex-1 h-3 rounded-sm animate-pulse" style={{ background: "var(--surface-2)" }} />
              <div className="w-20 h-3 rounded-sm animate-pulse" style={{ background: "var(--surface-2)" }} />
              <div className="w-14 h-3 rounded-sm animate-pulse" style={{ background: "var(--surface-2)" }} />
            </div>
          ))}
        </div>
      ) : stocks.length === 0 ? (
        <div className="py-8 text-center text-xs font-mono" style={{ color: "var(--muted)" }}>
          NO_DATA_AVAILABLE
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "8%" }} />
              <col style={{ width: "44%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "22%" }} />
            </colgroup>
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <th className="py-2 px-2 text-left" style={thStyle}>#</th>
                <th className="py-2 px-2 text-left" style={thStyle}>STOCK</th>
                <th className="py-2 px-2 text-right" style={thStyle}>LTP</th>
                <th className="py-2 px-2 text-right" style={thStyle}>CHG%</th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              <motion.tbody
                key={tab}
                initial="hidden"
                animate="visible"
                variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.03 } } }}
              >
                {stocks.map((s, i) => {
                  const isUp = s.change_pct >= 0;
                  return (
                    <motion.tr
                      key={s.ticker}
                      variants={{
                        hidden:   { opacity: 0, x: -6 },
                        visible:  { opacity: 1, x: 0, transition: { duration: 0.2 } },
                      }}
                      className="border-b cursor-pointer"
                      style={{ borderColor: "var(--border)", height: "44px" }}
                      onClick={() => router.push(`/stock/${s.ticker}`)}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                    >
                      <td className="py-2 px-2 text-xs" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}>
                        {i + 1}
                      </td>
                      <td className="py-2 px-2">
                        <div className="font-bold text-xs truncate" style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}>{s.name}</div>
                        <div className="text-xs tracking-wider uppercase" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}>
                          {s.ticker}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <AnimatedNumber
                          value={s.price}
                          format={fmtINR}
                          className="text-xs font-semibold tabular"
                          style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span
                          className="text-xs font-semibold tabular"
                          style={{ color: isUp ? "var(--up)" : "var(--down)", fontFamily: "var(--font-geist-mono)" }}
                        >
                          {isUp ? "+" : ""}{s.change_pct.toFixed(2)}%
                        </span>
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
