"use client";

import { useEffect } from "react";
import { useTrading } from "@/lib/trading-context";
import MarketWatch from "@/components/MarketWatch";
import OrderForm from "@/components/OrderForm";
import PortfolioPanel from "@/components/PortfolioPanel";

export default function Dashboard() {
  const { refreshPortfolio } = useTrading();

  useEffect(() => {
    refreshPortfolio();
  }, [refreshPortfolio]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center gap-3">
        <span className="text-green-400 font-bold text-xl tracking-tight">Tradio</span>
        <span className="text-gray-500 text-sm">NSE Paper Trading</span>
      </header>

      {/* Top panels — side by side on desktop, stacked on mobile */}
      <div className="flex flex-col lg:flex-row gap-4 p-4">
        <div className="lg:w-80 flex-shrink-0">
          <MarketWatch />
        </div>
        <div className="lg:w-96 flex-shrink-0">
          <OrderForm />
        </div>
      </div>

      {/* Bottom — Portfolio */}
      <div className="px-4 pb-4">
        <PortfolioPanel />
      </div>
    </div>
  );
}
