"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
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

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

// Format a unix timestamp for the crosshair tooltip
const fmtTooltipTime = (time: Time, period: Period): string => {
  if (typeof time !== "number") return String(time);
  const d = new Date(time * 1000);
  if (period === "1d" || period === "5d") {
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit",
      timeZone: "Asia/Kolkata", hour12: true,
    });
  }
  return d.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: period === "1y" ? "numeric" : undefined,
    timeZone: "Asia/Kolkata",
  });
};

// Format a unix timestamp for the X-axis labels (IST)
const makeAxisFormatter = (periodRef: React.MutableRefObject<Period>) =>
  (time: number | { year: number; month: number; day: number }): string => {
    if (typeof time !== "number") {
      return `${time.day}/${time.month}`;
    }
    const d = new Date(time * 1000);
    const p = periodRef.current;
    if (p === "1d") {
      return d.toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit",
        timeZone: "Asia/Kolkata", hour12: false,
      });
    }
    if (p === "5d") {
      return d.toLocaleDateString("en-IN", {
        weekday: "short", day: "numeric",
        timeZone: "Asia/Kolkata",
      });
    }
    return d.toLocaleDateString("en-IN", {
      day: "numeric", month: "short",
      timeZone: "Asia/Kolkata",
    });
  };

export default function ChartPanel({ ticker }: ChartPanelProps) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const areaSeriesRef = useRef<ISeriesApi<"Area"> | any>(null);
  const [period, setPeriod] = useState<Period>("1d");
  const periodRef = useRef<Period>("1d");
  const [chartType, setChartType] = useState<ChartType>("line");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ohlc, setOhlc] = useState<{ o: number; h: number; l: number; c: number } | null>(null);
  const [crosshair, setCrosshair] = useState<{ price: number; timeStr: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { periodRef.current = period; }, [period]);

  const getChartColors = () => {
    const s = getComputedStyle(document.documentElement);
    return {
      chartBg:     s.getPropertyValue("--chart-bg").trim()     || "#FFFFFF",
      chartGrid:   s.getPropertyValue("--chart-grid").trim()   || "#F1F5F9",
      chartText:   s.getPropertyValue("--chart-text").trim()   || "#64748B",
      chartBorder: s.getPropertyValue("--chart-border").trim() || "#E2E8F0",
    };
  };

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const { chartBg, chartGrid, chartText, chartBorder } = getChartColors();
    const axisFormatter = makeAxisFormatter(periodRef);

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: chartBg === "transparent" ? "transparent" : chartBg },
        textColor: chartText,
      },
      grid: {
        vertLines: { color: chartGrid },
        horzLines: { color: "transparent" },
      },
      crosshair: {
        mode: 0, // Normal — no magnet snap, free movement
        vertLine: {
          color: "rgba(100,100,120,0.7)",
          width: 1,
          style: 0,       // solid
          labelVisible: false,
        },
        horzLine: {
          visible: false,
          labelVisible: false,
        },
      },
      rightPriceScale: { visible: false },
      leftPriceScale:  { visible: false },
      timeScale: {
        borderColor: chartBorder,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: axisFormatter,
      },
      localization: {
        timeFormatter: axisFormatter,
      },
      handleScroll: false,
      handleScale:  false,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:        "#00C076",
      downColor:      "#FF3B30",
      borderUpColor:  "#00C076",
      borderDownColor:"#FF3B30",
      wickUpColor:    "#00C076",
      wickDownColor:  "#FF3B30",
    });

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor:    "#00C076",
      topColor:     "rgba(0,192,118,0.15)",
      bottomColor:  "rgba(0,192,118,0.0)",
      lineWidth:    2,
      priceLineVisible:           false,
      crosshairMarkerVisible:     true,
      crosshairMarkerRadius:      5,
      crosshairMarkerBorderColor: "#ffffff",
      crosshairMarkerBackgroundColor: "#00C076",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    areaSeriesRef.current   = areaSeries;

    candleSeries.applyOptions({ visible: false });
    areaSeries.applyOptions({ visible: true });

    // Crosshair move → floating label
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time) {
        setCrosshair(null);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const areaVal   = param.seriesData.get(areaSeriesRef.current)   as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candleVal = param.seriesData.get(candleSeriesRef.current) as any;

      const price: number | null =
        (areaVal   != null && "value" in areaVal)  ? areaVal.value   :
        (candleVal != null && "close" in candleVal) ? candleVal.close :
        null;

      if (price === null) { setCrosshair(null); return; }

      setCrosshair({
        price,
        timeStr: fmtTooltipTime(param.time, periodRef.current),
      });
    });

    return () => {
      chart.remove();
      chartRef.current        = null;
      candleSeriesRef.current = null;
      areaSeriesRef.current   = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update colors on theme change
  useEffect(() => {
    if (!chartRef.current) return;
    const { chartBg, chartGrid, chartText, chartBorder } = getChartColors();
    chartRef.current.applyOptions({
      layout: {
        background: { color: chartBg === "transparent" ? "transparent" : chartBg },
        textColor: chartText,
      },
      grid: { vertLines: { color: chartGrid }, horzLines: { color: "transparent" } },
      timeScale: { borderColor: chartBorder },
    });
  }, [resolvedTheme]);

  // Toggle series visibility
  useEffect(() => {
    if (!candleSeriesRef.current || !areaSeriesRef.current) return;
    candleSeriesRef.current.applyOptions({ visible: chartType === "candle" });
    areaSeriesRef.current.applyOptions({ visible: chartType === "line" });
  }, [chartType]);

  // Fetch data
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
        time:  c.time as Time,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      }));

      const areaData = data.candles.map((c: Candle) => ({
        time:  c.time as Time,
        value: c.close,
      }));

      candleSeriesRef.current.setData(candles);
      areaSeriesRef.current.setData(areaData);
      chartRef.current?.timeScale().fitContent();

      if (data.candles.length > 0) {
        const last  = data.candles[data.candles.length - 1];
        const first = data.candles[0];
        setOhlc({
          o: first.open,
          h: Math.max(...data.candles.map((c) => c.high)),
          l: Math.min(...data.candles.map((c) => c.low)),
          c: last.close,
        });
      }
      setCrosshair(null);
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
        {/* Crosshair price+time OR OHLC */}
        <div className="flex gap-3 text-xs tabular" style={{ color: "var(--muted)", minHeight: "20px" }}>
          {crosshair ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2"
            >
              <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                {formatINR(crosshair.price)}
              </span>
              <span
                className="px-1.5 py-0.5 rounded text-xs font-medium"
                style={{ background: "var(--surface-2)", color: "var(--muted)" }}
              >
                {crosshair.timeStr}
              </span>
            </motion.div>
          ) : ohlc ? (
            <>
              <span>O <span className="font-medium" style={{ color: "var(--text)" }}>{ohlc.o.toFixed(2)}</span></span>
              <span>H <span className="font-medium" style={{ color: "var(--up)" }}>{ohlc.h.toFixed(2)}</span></span>
              <span>L <span className="font-medium" style={{ color: "var(--down)" }}>{ohlc.l.toFixed(2)}</span></span>
              <span>C <span className="font-medium" style={{ color: "var(--text)" }}>{ohlc.c.toFixed(2)}</span></span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {/* Chart type */}
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

          {/* Period */}
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

      {/* Chart */}
      <motion.div
        className="relative flex-1"
        style={{ minHeight: "260px" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div ref={containerRef} className="w-full" style={{ height: "100%", minHeight: "260px" }} />
        {loading && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "var(--overlay)", backdropFilter: "blur(4px)" }}
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
