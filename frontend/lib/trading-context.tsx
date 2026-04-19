"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { useAuth } from "./auth-context";
import { api, Portfolio } from "./api";

const LS_KEY = "tradio_watchlist";

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
  const [watchlist, setWatchlist] = useState<string[]>([]);

  // Load watchlist: server when signed in, localStorage when signed out
  useEffect(() => {
    if (!isSignedIn) {
      try {
        const stored = localStorage.getItem(LS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) setWatchlist(parsed);
        }
      } catch {}
      return;
    }

    getToken().then(async (token) => {
      if (!token) return;
      try {
        const data = await api.getWatchlist(token);
        setWatchlist(data.tickers);
      } catch {}
    });
  }, [isSignedIn, getToken]);

  const addToWatchlist = useCallback((ticker: string) => {
    setWatchlist((prev) => {
      if (prev.includes(ticker)) return prev;
      return [...prev, ticker];
    });

    if (!isSignedIn) {
      setWatchlist((prev) => {
        try { localStorage.setItem(LS_KEY, JSON.stringify(prev)); } catch {}
        return prev;
      });
      return;
    }

    getToken().then((token) => {
      if (token) api.addToWatchlist(ticker, token).catch(() => {});
    });
  }, [isSignedIn, getToken]);

  const removeFromWatchlist = useCallback((ticker: string) => {
    setWatchlist((prev) => {
      const next = prev.filter((t) => t !== ticker);
      if (!isSignedIn) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
      }
      return next;
    });

    if (isSignedIn) {
      getToken().then((token) => {
        if (token) api.removeFromWatchlist(ticker, token).catch(() => {});
      });
    }
  }, [isSignedIn, getToken]);

  const setSelected = useCallback((ticker: string, price: number) => {
    setSelectedTicker(ticker);
    setSelectedPrice(price);
  }, []);

  const refreshPortfolio = useCallback(async () => {
    if (!isSignedIn) { setPortfolio(null); return; }
    setPortfolioLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const data = await api.getPortfolio(token);
      setPortfolio(data);
    } catch {
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
