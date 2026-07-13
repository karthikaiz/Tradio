"use client";

import { useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, AreaSeries, Time } from "lightweight-charts";
import { Portfolio } from "@/lib/api";

const STARTING_BALANCE = 100_000;

const fmtINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

interface ChartPoint { time: number; value: number }

interface Props {
  points: ChartPoint[] | null;
  portfolio: Portfolio | null;
  historyLoading?: boolean;
}

export default function PortfolioChart({ points, portfolio, historyLoading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<"Area"> | any>(null);

  const liveValue = portfolio
    ? portfolio.available_balance + (portfolio.total_current_value ?? 0)
    : STARTING_BALANCE;
  const pnl = liveValue - STARTING_BALANCE;
  const isUp = pnl >= 0;
  const lineColor = isUp ? "#00C076" : "#FF3B30";
  const topColor = isUp ? "rgba(0,192,118,0.18)" : "rgba(255,59,48,0.18)";

  const hasPoints = points && points.length >= 2;

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

  // Update data + colors when points change
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current || !hasPoints) return;
    seriesRef.current.applyOptions({ lineColor, topColor, bottomColor: "rgba(0,0,0,0)" });
    seriesRef.current.setData(points!.map((p) => ({ time: p.time as Time, value: p.value })));
    chartRef.current.timeScale().fitContent();
  }, [points, lineColor, topColor, hasPoints]);

  const isEmpty = !hasPoints;

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

        {/* Loading / empty overlay */}
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
                {historyLoading ? "Loading history…" : "Place a trade to see your chart"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
