"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { api, Portfolio } from "./api";

const DEFAULT_WATCHLIST = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "SBIN"];

interface TradingContextValue {
  selectedTicker: string;
  selectedPrice: number | null;
  setSelected: (ticker: string, price: number) => void;
  portfolio: Portfolio | null;
  portfolioLoading: boolean;
  refreshPortfolio: () => Promise<void>;
  watchlist: string[];
  addToWatchlist: (ticker: string) => void;
  removeFromWatchlist: (ticker: string) => void;
}

const TradingContext = createContext<TradingContextValue | null>(null);

export function TradingProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn } = useAuth();
  const [selectedTicker, setSelectedTicker] = useState("");
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST);

  // Load watchlist from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("tradio_watchlist");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setWatchlist(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const addToWatchlist = useCallback((ticker: string) => {
    setWatchlist((prev) => {
      if (prev.includes(ticker)) return prev;
      const next = [...prev, ticker];
      try { localStorage.setItem("tradio_watchlist", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const removeFromWatchlist = useCallback((ticker: string) => {
    setWatchlist((prev) => {
      const next = prev.filter((t) => t !== ticker);
      try { localStorage.setItem("tradio_watchlist", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const setSelected = useCallback((ticker: string, price: number) => {
    setSelectedTicker(ticker);
    setSelectedPrice(price);
  }, []);

  const refreshPortfolio = useCallback(async () => {
    if (!isSignedIn) {
      setPortfolio(null);
      return;
    }
    setPortfolioLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const data = await api.getPortfolio(token);
      setPortfolio(data);
    } catch {
      // ignore — user may not be signed in
    } finally {
      setPortfolioLoading(false);
    }
  }, [isSignedIn, getToken]);

  return (
    <TradingContext.Provider
      value={{
        selectedTicker, selectedPrice, setSelected,
        portfolio, portfolioLoading, refreshPortfolio,
        watchlist, addToWatchlist, removeFromWatchlist,
      }}
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
