"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, HealthScore } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const LABEL_COLOR: Record<string, string> = {
  DISCIPLINED: "var(--up)",
  CONSISTENT:  "var(--accent)",
  DEVELOPING:  "#f59e0b",
  LEARNING:    "var(--down)",
};

const SUB_LABELS: Record<string, string> = {
  diversification: "DIVERSIFICATION",
  concentration:   "CONCENTRATION",
  activity:        "ACTIVITY",
  discipline:      "DISCIPLINE",
};

const SUB_INFO: Record<string, string> = {
  diversification: "Number of stocks held. 5+ = full score. Spreading across stocks reduces single-stock risk.",
  concentration:   "Largest single holding as % of total invested. Under 30% = full score. Heavy concentration amplifies losses.",
  activity:        "Trades per week over last 30 days. 1–5/week = full score. Over-trading or no trading both hurt.",
  discipline:      "% of trades with a reason logged. 80%+ = full score. Logging reasons builds self-awareness.",
};

function SubBar({ label, score }: { label: string; score: number }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const pct = (score / 25) * 100;
  const color = pct >= 80 ? "var(--up)" : pct >= 60 ? "var(--accent)" : pct >= 40 ? "#f59e0b" : "var(--down)";

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 flex-shrink-0" style={{ width: "120px" }}>
          <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px", letterSpacing: "0.06em" }}>
            {SUB_LABELS[label]}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setInfoOpen((v) => !v); }}
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: "13px", height: "13px",
              borderRadius: "50%",
              border: `1px solid ${infoOpen ? "var(--accent)" : "var(--border-2)"}`,
              color: infoOpen ? "var(--accent)" : "var(--muted)",
              fontFamily: "var(--font-geist-mono)",
              fontSize: "8px",
              background: "transparent",
              cursor: "pointer",
              lineHeight: 1,
            }}
            aria-label="info"
          >
            i
          </button>
        </div>
        <div className="flex-1 h-1 rounded-full" style={{ background: "var(--border)" }}>
          <motion.div
            className="h-1 rounded-full"
            style={{ background: color }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
        <span className="text-xs w-6 text-right flex-shrink-0" style={{ color, fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}>
          {score}
        </span>
      </div>

      <AnimatePresence>
        {infoOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="mt-1.5 ml-1"
              style={{
                color: "var(--muted)",
                fontFamily: "var(--font-geist-mono)",
                fontSize: "10px",
                lineHeight: 1.6,
                borderLeft: "2px solid var(--border-2)",
                paddingLeft: "8px",
              }}
            >
              {SUB_INFO[label]}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function HealthScoreWidget() {
  const { isSignedIn, getToken } = useAuth();
  const [data, setData] = useState<HealthScore | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    getToken().then((token) => {
      if (!token) return;
      api.getHealthScore(token).then(setData).catch(() => {});
    });
  }, [isSignedIn, getToken]);

  if (!data) return null;

  if (data.label === "NEW") {
    return (
      <div
        className="px-4 py-3"
        style={{ border: "1px solid var(--border)", borderRadius: "2px", background: "var(--surface)" }}
      >
        <div className="flex items-center justify-between">
          <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px", letterSpacing: "0.06em" }}>
            PORTFOLIO_HEALTH
          </span>
          <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}>
            —/100
          </span>
        </div>
        <p style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px", marginTop: "8px", lineHeight: 1.6 }}>
          Make your first trade to build your score.
        </p>
      </div>
    );
  }

  const color = LABEL_COLOR[data.label] ?? "var(--accent)";
  const pct = data.score;

  return (
    <div
      className="px-4 py-3 cursor-pointer"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "2px",
        background: "var(--surface)",
      }}
      onClick={() => setOpen((o) => !o)}
    >
      {/* Header row */}
      <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
        <span
          className="text-xs font-bold tracking-widest flex-shrink-0"
          style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}
        >
          PORTFOLIO_HEALTH
        </span>

        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <div className="hidden sm:block w-20 h-1 rounded-full" style={{ background: "var(--border)" }}>
            <motion.div
              className="h-1 rounded-full"
              style={{ background: color }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
          <span
            className="font-black text-sm"
            style={{ color, fontFamily: "var(--font-geist-mono)" }}
          >
            {data.score}<span style={{ color: "var(--muted)", fontSize: "10px" }}>/100</span>
          </span>
          <span style={{ color: "var(--muted)", fontSize: "10px", fontFamily: "var(--font-geist-mono)" }}>
            {open ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {/* Expandable breakdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2.5 pt-4">
              {Object.entries(data.breakdown).map(([key, val]) => (
                <SubBar key={key} label={key} score={val} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
