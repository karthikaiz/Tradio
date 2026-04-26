"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTrading } from "@/lib/trading-context";
import { api } from "@/lib/api";
import TerminalShell from "@/components/TerminalShell";
import StockList from "@/components/StockList";
import MarketCategories from "@/components/MarketCategories";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import SearchBox from "@/components/SearchBox";
import OnboardingModal, { useOnboarding } from "@/components/OnboardingModal";
import HealthScoreWidget from "@/components/HealthScoreWidget";

const fmtIdx = (v: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);

const IDX_LIST = [
  { label: "NIFTY 50",   ticker: "^NSEI" },
  { label: "SENSEX",     ticker: "^BSESN" },
  { label: "BANK NIFTY", ticker: "^NSEBANK" },
];

interface IndexTick { label: string; value: number; changePct: number }

function useIndices() {
  const [data, setData] = useState<IndexTick[]>([]);
  const baselineRef = useRef<Record<string, number>>({});

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.getMultiPrice(IDX_LIST.map((i) => i.ticker));
      const result: IndexTick[] = [];
      for (const idx of IDX_LIST) {
        const entry = res.prices[idx.ticker];
        if (!entry?.price) continue;
        if (!baselineRef.current[idx.ticker]) baselineRef.current[idx.ticker] = entry.price;
        const baseline = baselineRef.current[idx.ticker];
        result.push({ label: idx.label, value: entry.price, changePct: ((entry.price - baseline) / baseline) * 100 });
      }
      if (result.length) setData(result);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 60000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return data;
}

function IndexStrip({ indices }: { indices: IndexTick[] }) {
  if (!indices.length) return null;

  const items = [...indices, ...indices];

  return (
    <div
      className="overflow-hidden border-b flex-shrink-0"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="ticker-track py-3">
        {items.map((idx, i) => {
          const isUp = idx.changePct >= 0;
          return (
            <span key={i} className="inline-flex items-center gap-3 mx-8">
              <span
                className="text-xs font-semibold tracking-widest"
                style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
              >
                {idx.label}
              </span>
              <AnimatedNumber
                value={idx.value}
                format={fmtIdx}
                className="text-sm font-black"
                style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}
              />
              <span
                className="text-xs font-bold"
                style={{ color: isUp ? "var(--up)" : "var(--down)", fontFamily: "var(--font-geist-mono)" }}
              >
                {isUp ? "▲" : "▼"} {Math.abs(idx.changePct).toFixed(2)}%
              </span>
              <span style={{ color: "var(--border-2)", marginLeft: "8px" }}>·</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const { refreshPortfolio } = useTrading();
  const indices = useIndices();
  const { show: showOnboarding, done: onboardingDone } = useOnboarding();

  useEffect(() => {
    if (!isSignedIn) router.replace("/sign-in");
  }, [isSignedIn, router]);

  useEffect(() => { refreshPortfolio(); }, [refreshPortfolio]);

  if (!isSignedIn) return null;

  return (
    <TerminalShell>
      <OnboardingModal show={showOnboarding} onDone={onboardingDone} />
      <div className="flex flex-col min-h-[calc(100vh-56px)] overflow-y-auto">

        {/* ── 1. Scrolling index strip ──────────────────────── */}
        <IndexStrip indices={indices} />

        {/* ── 2. Search bar — mobile only ──────────────────── */}
        <div className="md:hidden px-4 pt-4 pb-2">
          <SearchBox showWatchButton placeholder="Search stocks — RELIANCE, TCS, INFY…" />
        </div>

        {/* ── 3. Health Score ──────────────────────────────── */}
        <section className="px-4 md:px-8 pt-6 pb-2 w-full max-w-5xl mx-auto">
          <HealthScoreWidget />
        </section>

        {/* ── 4. Market Overview ──────────────────────────── */}
        <section className="px-4 md:px-8 py-8 w-full max-w-5xl mx-auto">
          <div
            className="text-xs font-semibold tracking-widest mb-4"
            style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
          >
            MARKET_OVERVIEW
          </div>
          <MarketCategories />
        </section>

        {/* ── 4. Watchlist ─────────────────────────────────── */}
        <section
          className="px-4 md:px-8 py-8 w-full max-w-5xl mx-auto border-t"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="text-xs font-semibold tracking-widest mb-4"
            style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
          >
            WATCHLIST_PRIMARY
          </div>
          {/* Full-width table — not cramped */}
          <div
            className="overflow-hidden"
            style={{ border: "1px solid var(--border)", borderRadius: "2px", background: "var(--surface)" }}
          >
            <StockList />
          </div>
        </section>

        <div className="h-16" /> {/* bottom breathing room */}
      </div>
    </TerminalShell>
  );
}
