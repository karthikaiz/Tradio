"use client";

import { useTrading } from "@/lib/trading-context";
import AnimatedNumber from "./ui/AnimatedNumber";

const fmt0 = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

export default function StatusBar() {
  const { portfolio } = useTrading();

  return (
    <div
      className="hidden md:flex fixed bottom-0 left-0 right-0 z-40 items-center px-4 gap-5"
      style={{
        height: "36px",
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
        fontFamily: "var(--font-geist-mono)",
        fontSize: "11px",
      }}
    >
      <span style={{ color: "var(--muted)", letterSpacing: "0.08em" }}>PORTFOLIO_SUMMARY</span>

      {portfolio && (
        <>
          <span style={{ color: "var(--muted)" }}>
            BALANCE:{" "}
            <AnimatedNumber
              value={portfolio.available_balance}
              format={fmt0}
              className="font-semibold"
              style={{ color: "var(--text)" }}
            />
          </span>

          <span style={{ color: "var(--muted)" }}>
            INVESTED:{" "}
            <span style={{ color: "var(--text)" }}>{fmt0(portfolio.total_invested)}</span>
          </span>

          {portfolio.total_unrealized_pnl !== 0 && (
            <span style={{ color: "var(--muted)" }}>
              DAY P&L:{" "}
              <span style={{ color: portfolio.total_unrealized_pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                {portfolio.total_unrealized_pnl >= 0 ? "+" : ""}
                {fmt0(portfolio.total_unrealized_pnl)}{" "}
                ({portfolio.total_unrealized_pnl_pct >= 0 ? "+" : ""}
                {portfolio.total_unrealized_pnl_pct.toFixed(2)}%)
              </span>
            </span>
          )}
        </>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <span className="live-dot" style={{ width: "6px", height: "6px" }} />
        <span style={{ color: "var(--up)", letterSpacing: "0.08em" }}>SYSTEM_ONLINE</span>
        <span style={{ color: "var(--text-dim)" }}>·</span>
        <span style={{ color: "var(--text-dim)" }}>NSE</span>
      </div>
    </div>
  );
}
