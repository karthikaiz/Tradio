"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import AnimatedNumber from "./ui/AnimatedNumber";

interface StockRowProps {
  ticker: string;
  name?: string;
  price: number | null;
  prevPrice?: number | null;
  error?: string | null;
  onRemove?: () => void;
  index?: number;
}

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

export default function StockRow({ ticker, name, price, prevPrice, error, onRemove, index = 0 }: StockRowProps) {
  const router = useRouter();
  const [flashClass, setFlashClass] = useState("");
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    if (price === null || prevRef.current === null) {
      prevRef.current = price;
      return;
    }
    if (price > prevRef.current) {
      setFlashClass("flash-up");
    } else if (price < prevRef.current) {
      setFlashClass("flash-down");
    }
    prevRef.current = price;
    const t = setTimeout(() => setFlashClass(""), 700);
    return () => clearTimeout(t);
  }, [price]);

  const change = price !== null && prevPrice !== null && prevPrice !== undefined
    ? price - prevPrice
    : null;
  const changePct = change !== null && prevPrice ? (change / prevPrice) * 100 : null;
  const isUp = change === null || change >= 0;

  return (
    <motion.tr
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className={`border-b cursor-pointer group ${flashClass}`}
      style={{ borderColor: "var(--border)" }}
      onClick={() => router.push(`/stock/${ticker}`)}
      whileHover={{ backgroundColor: "rgba(255,255,255,0.03)", x: 3 } as never}
    >
      <td className="py-3 px-4">
        <div className="font-bold text-sm tracking-wide uppercase" style={{ color: "var(--text)" }}>{ticker}</div>
        {name && <div className="text-xs truncate max-w-[140px]" style={{ color: "var(--muted)" }}>{name}</div>}
      </td>
      <td className="py-3 px-4 tabular text-right">
        {price !== null ? (
          <AnimatedNumber
            value={price}
            format={formatINR}
            className="font-semibold text-sm"
            style={{ color: "var(--text)" }}
          />
        ) : (
          <span className="text-xs" style={{ color: "var(--muted)" }}>{error || "—"}</span>
        )}
      </td>
      <td className="py-3 px-4 tabular text-right text-sm">
        {change !== null ? (
          <span style={{ color: isUp ? "var(--up)" : "var(--down)" }}>
            {isUp ? "+" : ""}{change.toFixed(2)}
          </span>
        ) : <span style={{ color: "var(--muted)" }}>—</span>}
      </td>
      <td className="py-3 px-4 tabular text-right">
        {changePct !== null ? (
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{
              color: isUp ? "var(--up)" : "var(--down)",
              background: isUp ? "rgba(0,229,160,0.1)" : "rgba(255,77,109,0.1)",
            }}
          >
            {isUp ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
          </span>
        ) : <span style={{ color: "var(--muted)" }}>—</span>}
      </td>
      <td className="py-3 px-4 text-right opacity-0 group-hover:opacity-100 transition-opacity">
        {onRemove && (
          <motion.button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--muted)" }}
            whileHover={{ color: "var(--down)", scale: 1.1 } as never}
            whileTap={{ scale: 0.9 }}
          >
            ✕
          </motion.button>
        )}
      </td>
    </motion.tr>
  );
}
