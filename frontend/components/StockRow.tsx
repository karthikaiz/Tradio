"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AnimatedNumber from "./ui/AnimatedNumber";

interface StockRowProps {
  ticker: string;
  name?: string;
  price: number | null;
  prevPrice?: number | null;
  error?: string | null;
  onRemove?: () => void;
  index?: number;
  selected?: boolean;
}

const fmtPrice = (v: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);

export default function StockRow({
  ticker, name, price, prevPrice, error, onRemove, index = 0, selected = false,
}: StockRowProps) {
  const router = useRouter();
  const [flashClass, setFlashClass] = useState("");
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    if (price === null || prevRef.current === null) { prevRef.current = price; return; }
    if (price > prevRef.current) setFlashClass("flash-up");
    else if (price < prevRef.current) setFlashClass("flash-down");
    prevRef.current = price;
    const t = setTimeout(() => setFlashClass(""), 700);
    return () => clearTimeout(t);
  }, [price]);

  const change = price !== null && prevPrice != null ? price - prevPrice : null;
  const changePct = change !== null && prevPrice ? (change / prevPrice) * 100 : null;
  const isUp = change === null || change >= 0;

  return (
    <tr
      className={`cursor-pointer group border-b ${flashClass}`}
      style={{
        borderColor: "var(--border)",
        background: selected ? "var(--surface-2)" : "transparent",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        height: "44px",
        transition: "background 0.1s",
      }}
      onClick={() => router.push(`/stock/${ticker}`)}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {/* Name + ticker */}
      <td className="px-4 py-3">
        <div className="font-bold text-xs truncate" style={{ color: selected ? "var(--accent)" : "var(--text)", fontFamily: "var(--font-geist-mono)" }}>
          {name ?? ticker}
        </div>
        {name && (
          <div className="text-xs tracking-wider uppercase" style={{ color: "var(--text-dim)", fontFamily: "var(--font-geist-mono)" }}>
            {ticker}
          </div>
        )}
      </td>

      {/* Price */}
      <td className="px-4 py-2 text-right">
        {price !== null ? (
          <AnimatedNumber
            value={price}
            format={fmtPrice}
            className="text-xs font-semibold"
            style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)" }}
          />
        ) : (
          <span className="text-xs" style={{ color: "var(--muted)" }}>{error ?? "—"}</span>
        )}
      </td>

      {/* CHG% */}
      <td className="px-4 py-2 text-right">
        {changePct !== null ? (
          <span
            className="text-xs font-semibold tabular"
            style={{ color: isUp ? "var(--up)" : "var(--down)", fontFamily: "var(--font-geist-mono)" }}
          >
            {isUp ? "+" : ""}{changePct.toFixed(2)}%
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>
        )}
      </td>

      {/* Remove */}
      <td className="pr-3 py-2 text-right">
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="opacity-0 group-hover:opacity-100 text-xs px-1.5 py-0.5 transition-opacity"
            style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--down)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--muted)")}
          >
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}
