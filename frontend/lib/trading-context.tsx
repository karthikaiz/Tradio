"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { api, Portfolio } from "./api";

interface TradingContextValue {
  selectedTicker: string;
  selectedPrice: number | null;
  setSelected: (ticker: string, price: number) => void;
  portfolio: Portfolio | null;
  portfolioLoading: boolean;
  refreshPortfolio: () => Promise<void>;
}

const TradingContext = createContext<TradingContextValue | null>(null);

export function TradingProvider({ children }: { children: ReactNode }) {
  const [selectedTicker, setSelectedTicker] = useState("");
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  const setSelected = useCallback((ticker: string, price: number) => {
    setSelectedTicker(ticker);
    setSelectedPrice(price);
  }, []);

  const refreshPortfolio = useCallback(async () => {
    setPortfolioLoading(true);
    try {
      const data = await api.getPortfolio();
      setPortfolio(data);
    } finally {
      setPortfolioLoading(false);
    }
  }, []);

  return (
    <TradingContext.Provider
      value={{ selectedTicker, selectedPrice, setSelected, portfolio, portfolioLoading, refreshPortfolio }}
    >
      {children}
    </TradingContext.Provider>
  );
}

export function useTrading() {
  const ctx = useContext(TradingContext);
  if (!ctx) throw new Error("useTrading must be used inside TradingProvider");
  return ctx;
}
