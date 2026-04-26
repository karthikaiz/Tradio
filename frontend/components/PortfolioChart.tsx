"use client";

import { useEffect, useRef, useMemo } from "react";
import { createChart, IChartApi, ISeriesApi, AreaSeries, Time } from "lightweight-charts";
import { OrderRecord, Portfolio } from "@/lib/api";

const STARTING_BALANCE = 100_000;

const fmtINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

interface Point { time: number; value: number }

function buildChartData(orders: OrderRecord[], portfolio: Portfolio | null): Point[] {
  const sorted = [...orders].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let cash = STARTING_BALANCE;
  const holdings: Record<string, { qty: number; avgPrice: number }> = {};
  const points: Point[] = [];
  const usedTimes = new Set<number>();

  const uniqueTime = (t: number) => {
    while (usedTimes.has(t)) t++;
    usedTimes.add(t);
    return t;
  };

  if (sorted.length > 0) {
    const firstT = Math.floor(new Date(sorted[0].timestamp).getTime() / 1000) - 60;
    points.push({ time: uniqueTime(firstT), value: STARTING_BALANCE });
  }

  for (const order of sorted) {
    const t = uniqueTime(Math.floor(new Date(order.timestamp).getTime() / 1000));

    if (order.side === "BUY") {
      cash -= order.quantity * order.execution_price;
      const prev = holdings[order.ticker] ?? { qty: 0, avgPrice: 0 };
      const newQty = prev.qty + order.quantity;
      holdings[order.ticker] = {
        qty: newQty,
        avgPrice: (prev.qty * prev.avgPrice + order.quantity * order.execution_price) / newQty,
      };
    } else {
      cash += order.quantity * order.execution_price;
      const prev = holdings[order.ticker];
      if (prev) {
        const remaining = prev.qty - order.quantity;
        if (remaining <= 0) delete holdings[order.ticker];
        else holdings[order.ticker] = { qty: remaining, avgPrice: prev.avgPrice };
      }
    }

    const holdingsVal = Object.values(holdings).reduce((s, h) => s + h.qty * h.avgPrice, 0);
    points.push({ time: t, value: Math.round(cash + holdingsVal) });
  }

  // Live endpoint using current market prices
  if (portfolio && sorted.length > 0) {
    const liveVal = portfolio.available_balance + (portfolio.total_current_value ?? 0);
    const liveT = uniqueTime(Math.floor(Date.now() / 1000));
    if (liveT > (points[points.length - 1]?.time ?? 0)) {
      points.push({ time: liveT, value: Math.round(liveVal) });
    }
  }

  return points;
}

interface Props {
  orders: OrderRecord[];
  portfolio: Portfolio | null;
}

export default function PortfolioChart({ orders, portfolio }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<"Area"> | any>(null);

  const points = useMemo(() => buildChartData(orders, portfolio), [orders, portfolio]);

  const liveValue = portfolio
    ? portfolio.available_balance + (portfolio.total_current_value ?? 0)
    : STARTING_BALANCE;
  const pnl = liveValue - STARTING_BALANCE;
  const isUp = pnl >= 0;
  const lineColor = isUp ? "#00C076" : "#FF3B30";
  const topColor = isUp ? "rgba(0,192,118,0.18)" : "rgba(255,59,48,0.18)";

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#606880" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "transparent" } },
      crosshair: {
        mode: 0,
        vertLine: { color: "rgba(100,100,120,0.7)", width: 1, style: 0, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "#2A2A3A",
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor,
      topColor,
      bottomColor: "rgba(0,0,0,0)",
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#ffffff",
      crosshairMarkerBackgroundColor: lineColor,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update data + colors when points/portfolio change
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current || points.length < 2) return;
    seriesRef.current.applyOptions({ lineColor, topColor, bottomColor: "rgba(0,0,0,0)" });
    seriesRef.current.setData(points.map((p) => ({ time: p.time as Time, value: p.value })));
    chartRef.current.timeScale().fitContent();
  }, [points, lineColor, topColor]);

  const isEmpty = orders.length === 0;

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Header row — only when data exists */}
      {!isEmpty && (
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "9px", color: "var(--muted)", letterSpacing: "0.1em" }}>
            PORTFOLIO_VALUE
          </span>
          <div className="flex items-center gap-3">
            <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "13px", fontWeight: 700, color: "var(--text)" }}>
              {fmtINR(liveValue)}
            </span>
            <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "11px", fontWeight: 600, color: isUp ? "var(--up)" : "var(--down)" }}>
              {isUp ? "▲" : "▼"} {fmtINR(Math.abs(pnl))} ({((pnl / STARTING_BALANCE) * 100).toFixed(2)}%)
            </span>
          </div>
        </div>
      )}

      {/* Chart container — always in DOM so the chart can be created on mount */}
      <div style={{ position: "relative", height: "150px" }}>
        <div ref={containerRef} style={{ height: "100%", width: "100%" }} />

        {/* Empty state overlay */}
        {isEmpty && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--surface)",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: "10px", color: "var(--muted)", letterSpacing: "0.08em" }}>
                PORTFOLIO_CHART
              </div>
              <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: "11px", color: "var(--text-dim)", marginTop: "6px" }}>
                Place a trade to see your chart
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
