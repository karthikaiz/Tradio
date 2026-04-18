"use client";

import TerminalShell from "@/components/TerminalShell";
import PortfolioPanel from "@/components/PortfolioPanel";

export default function PortfolioPage() {
  return (
    <TerminalShell>
      <div className="flex flex-col md:h-[calc(100vh-92px)] md:overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center px-5 py-2.5 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <span
            className="text-xs font-semibold tracking-widest"
            style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
          >
            PORTFOLIO_OVERVIEW
          </span>
        </div>
        {/* Content */}
        <div className="flex-1 md:overflow-auto">
          <PortfolioPanel />
        </div>
      </div>
    </TerminalShell>
  );
}
