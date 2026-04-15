"use client";

import { useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@clerk/nextjs";
import { useTrading } from "@/lib/trading-context";
import Navbar from "@/components/Navbar";
import StockList from "@/components/StockList";
import PortfolioPanel from "@/components/PortfolioPanel";
import MarketCategories from "@/components/MarketCategories";
import PageTransition from "@/components/ui/PageTransition";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import LiveDot from "@/components/ui/LiveDot";

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

export default function DashboardPage() {
  const { refreshPortfolio, portfolio } = useTrading();
  const { userId } = useAuth();

  useEffect(() => {
    refreshPortfolio();
  }, [refreshPortfolio]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <Navbar />

      <PageTransition className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
        {/* Greeting row */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold" style={{ color: "var(--text)" }}>
              Dashboard
            </h1>
            {portfolio && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs" style={{ color: "var(--muted)" }}>Portfolio value:</span>
                <AnimatedNumber
                  value={portfolio.available_balance + portfolio.total_invested}
                  format={formatINR}
                  className="text-xs font-semibold"
                  style={{ color: "var(--text)" }}
                />
                {portfolio.total_unrealized_pnl !== 0 && (
                  <span
                    className="text-xs font-semibold"
                    style={{
                      color: portfolio.total_unrealized_pnl >= 0 ? "var(--up)" : "var(--down)",
                    }}
                  >
                    ({portfolio.total_unrealized_pnl >= 0 ? "▲ +" : "▼ "}
                    {formatINR(portfolio.total_unrealized_pnl)})
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <LiveDot />
            <span className="text-xs" style={{ color: "var(--muted)" }}>Live</span>
          </div>
        </div>

        {/* Main grid: watchlist sidebar + market content */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
          {/* Sidebar: watchlist */}
          <motion.aside
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Watchlist
              </h2>
              <span className="text-xs" style={{ color: "var(--muted)" }}>Click to trade →</span>
            </div>
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "var(--surface)",
                backdropFilter: "blur(var(--glass-blur))",
                WebkitBackdropFilter: "blur(var(--glass-blur))",
                border: "1px solid var(--border)",
                minHeight: "400px",
              }}
            >
              <StockList />
            </div>
          </motion.aside>

          {/* Main: market overview + portfolio */}
          <motion.main
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex flex-col gap-6"
          >
            {/* Market Overview */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                  Market Overview
                </h2>
                <LiveDot />
              </div>
              <MarketCategories />
            </section>

            {/* Portfolio summary */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                  Portfolio
                </h2>
                <Link
                  href="/portfolio"
                  className="text-xs font-semibold transition-colors"
                  style={{ color: "var(--accent)" }}
                >
                  View all →
                </Link>
              </div>
              <PortfolioPanel />
            </section>
          </motion.main>
        </div>
      </PageTransition>
    </div>
  );
}
