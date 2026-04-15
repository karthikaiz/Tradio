"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  CandlestickSeries,
  AreaSeries,
} from "lightweight-charts";
import { api, Candle } from "@/lib/api";

interface ChartPanelProps {
  ticker: string;
}

type Period = "1d" | "5d" | "1mo" | "3mo" | "1y";
type ChartType = "line" | "candle";

const PERIODS: { label: string; value: Period }[] = [
  { label: "1D", value: "1d" },
  { label: "5D", value: "5d" },
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "1Y", value: "1y" },
];

export default function ChartPanel({ ticker }: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const areaSeriesRef = useRef<ISeriesApi<"Area"> | any>(null);
  const [period, setPeriod] = useState<Period>("1d");
  const [chartType, setChartType] = useState<ChartType>("line");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ohlc, setOhlc] = useState<{ o: number; h: number; l: number; c: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#8892A4",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        vertLine: { color: "rgba(91,139,255,0.5)", width: 1, style: 3 },
        horzLine: { color: "rgba(91,139,255,0.5)", width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.06)",
        textColor: "#8892A4",
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00E5A0",
      downColor: "#FF4D6D",
      borderUpColor: "#00E5A0",
      borderDownColor: "#FF4D6D",
      wickUpColor: "#00E5A0",
      wickDownColor: "#FF4D6D",
    });

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: "#5B8BFF",
      topColor: "rgba(91,139,255,0.3)",
      bottomColor: "rgba(91,139,255,0.0)",
      lineWidth: 2,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    areaSeriesRef.current = areaSeries;

    // Default: show area, hide candle
    candleSeries.applyOptions({ visible: false });
    areaSeries.applyOptions({ visible: true });

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      areaSeriesRef.current = null;
    };
  }, []);

  // Toggle chart type visibility
  useEffect(() => {
    if (!candleSeriesRef.current || !areaSeriesRef.current) return;
    candleSeriesRef.current.applyOptions({ visible: chartType === "candle" });
    areaSeriesRef.current.applyOptions({ visible: chartType === "line" });
  }, [chartType]);

  // Fetch chart data when ticker or period changes
  const fetchHistory = useCallback(async () => {
    if (!candleSeriesRef.current || !areaSeriesRef.current) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);

    try {
      const data = await api.getHistory(ticker, period, abortRef.current.signal);
      if (abortRef.current.signal.aborted) return;

      const candles: CandlestickData[] = data.candles.map((c: Candle) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const areaData = data.candles.map((c: Candle) => ({
        time: c.time as Time,
        value: c.close,
      }));

      candleSeriesRef.current.setData(candles);
      areaSeriesRef.current.setData(areaData);
      chartRef.current?.timeScale().fitContent();

      if (data.candles.length > 0) {
        const last = data.candles[data.candles.length - 1];
        const first = data.candles[0];
        setOhlc({
          o: first.open,
          h: Math.max(...data.candles.map((c) => c.high)),
          l: Math.min(...data.candles.map((c) => c.low)),
          c: last.close,
        });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError("Failed to load chart data");
    } finally {
      if (!abortRef.current?.signal.aborted) setLoading(false);
    }
  }, [ticker, period]);

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 15000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  return (
    <div className="flex flex-col h-full" style={{ background: "transparent" }}>
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b flex-wrap gap-2"
        style={{ borderColor: "var(--border)" }}
      >
        {/* OHLC */}
        <div className="flex gap-3 text-xs tabular" style={{ color: "var(--muted)" }}>
          {ohlc && (
            <>
              <span>O <span className="font-medium" style={{ color: "var(--text)" }}>{ohlc.o.toFixed(2)}</span></span>
              <span>H <span className="font-medium" style={{ color: "var(--up)" }}>{ohlc.h.toFixed(2)}</span></span>
              <span>L <span className="font-medium" style={{ color: "var(--down)" }}>{ohlc.l.toFixed(2)}</span></span>
              <span>C <span className="font-medium" style={{ color: "var(--text)" }}>{ohlc.c.toFixed(2)}</span></span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Chart type toggle — sliding pill */}
          <div
            className="flex rounded-lg overflow-hidden relative"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            {(["line", "candle"] as ChartType[]).map((t) => (
              <button
                key={t}
                onClick={() => setChartType(t)}
                className="relative px-3 py-1 text-xs font-medium transition-colors capitalize z-10"
                style={{ color: chartType === t ? "var(--text)" : "var(--muted)" }}
              >
                {chartType === t && (
                  <motion.div
                    layoutId="chart-type-pill"
                    className="absolute inset-0 rounded-md"
                    style={{ background: "var(--accent)", opacity: 0.8 }}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10">{t === "line" ? "Line" : "Candle"}</span>
              </button>
            ))}
          </div>

          {/* Period selector — sliding pill */}
          <div
            className="flex rounded-lg overflow-hidden relative"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className="relative px-2.5 py-1 text-xs font-medium transition-colors z-10"
                style={{ color: period === p.value ? "var(--text)" : "var(--muted)" }}
              >
                {period === p.value && (
                  <motion.div
                    layoutId="period-pill"
                    className="absolute inset-0 rounded-md"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border-2)" }}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart container */}
      <motion.div
        className="relative flex-1 min-h-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div ref={containerRef} className="w-full h-full" />
        {loading && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(7,11,20,0.6)", backdropFilter: "blur(4px)" }}
          >
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-2 h-2 rounded-full"
                  style={{ background: "var(--accent)" }}
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }}
                />
              ))}
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm" style={{ color: "var(--muted)" }}>{error}</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
