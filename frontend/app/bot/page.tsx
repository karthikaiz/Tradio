"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import TerminalShell from "@/components/TerminalShell";
import { api, BotStatus, BotPosition, BotScanResult, BotLogEntry } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined, dec = 2) =>
  v == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: dec }).format(v);

const fmtPnl = (v: number | null | undefined) => {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}₹${fmt(v, 0)}`;
};

const fmtPct = (entry: number, current: number | null) => {
  if (current == null) return null;
  const pct = ((current - entry) / entry) * 100;
  return pct;
};

const timeSince = (iso: string | null) => {
  if (!iso) return "never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: BotStatus["status"] }) {
  const color = status === "RUNNING" ? "var(--up)" : status === "HALTED" ? "var(--down)" : "var(--muted)";
  const dot = status === "RUNNING" ? "●" : "○";
  return (
    <span style={{ color, fontFamily: "var(--font-geist-mono)", fontSize: "12px", fontWeight: 700 }}>
      {dot} {status}
    </span>
  );
}

function ClimateBadge({ score, regime }: { score: number | null; regime: string | null }) {
  if (score == null) return <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>CLIMATE —</span>;
  const color = score >= 65 ? "var(--up)" : score >= 45 ? "#f59e0b" : "var(--down)";
  return (
    <span style={{ color, fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>
      CLIMATE {score} {regime ?? ""}
    </span>
  );
}

function StatusBar({ status, loading }: { status: BotStatus | null; loading: boolean }) {
  const s = status;
  return (
    <div
      className="flex flex-wrap items-center gap-4 px-5 py-3"
      style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}
    >
      {loading && !s ? (
        <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>loading...</span>
      ) : s ? (
        <>
          <StatusPill status={s.status} />
          <span style={{ color: "var(--border-2)" }}>│</span>
          <ClimateBadge score={s.climate_score} regime={s.climate_regime} />
          <span style={{ color: "var(--border-2)" }}>│</span>
          <span style={{
            fontFamily: "var(--font-geist-mono)", fontSize: "11px",
            color: s.circuit_breaker === "OK" ? "var(--muted)" : "var(--down)",
          }}>
            CIRCUIT {s.circuit_breaker}
          </span>
          <span style={{ color: "var(--border-2)" }}>│</span>
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "11px", color: s.daily_pnl != null && s.daily_pnl >= 0 ? "var(--up)" : "var(--down)" }}>
            P&L {fmtPnl(s.daily_pnl)}
          </span>
          <span style={{ color: "var(--border-2)" }}>│</span>
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "11px", color: "var(--muted)" }}>
            {s.open_positions_count}/5 pos
          </span>
          <span style={{ color: "var(--border-2)" }}>│</span>
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "10px", color: "var(--muted)" }}>
            hb {timeSince(s.last_heartbeat)}
          </span>
        </>
      ) : (
        <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>bot offline</span>
      )}
    </div>
  );
}

function PositionCard({ pos }: { pos: BotPosition }) {
  const [expanded, setExpanded] = useState(false);
  const pct = fmtPct(pos.entry_price, pos.current_price);
  const pctColor = pct == null ? "var(--muted)" : pct >= 0 ? "var(--up)" : "var(--down)";

  return (
    <div
      className="p-4"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border-2)",
        borderRadius: "2px",
        fontFamily: "var(--font-geist-mono)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span style={{ color: "var(--accent)", fontSize: "14px", fontWeight: 700 }}>{pos.ticker}</span>
          <span style={{ color: "var(--muted)", fontSize: "10px", marginLeft: "8px" }}>{pos.strategy}</span>
        </div>
        <span style={{ color: pctColor, fontSize: "13px", fontWeight: 700 }}>
          {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1" style={{ fontSize: "11px" }}>
        <div>
          <span style={{ color: "var(--muted)" }}>entry  </span>
          <span style={{ color: "var(--text)" }}>₹{fmt(pos.entry_price)}</span>
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>current  </span>
          <span style={{ color: "var(--text)" }}>₹{fmt(pos.current_price)}</span>
        </div>
        <div>
          <span style={{ color: "var(--down)" }}>stop  </span>
          <span style={{ color: "var(--text)" }}>₹{fmt(pos.stop_loss)}</span>
        </div>
        <div>
          <span style={{ color: "var(--up)" }}>t1  </span>
          <span style={{ color: "var(--text)" }}>₹{fmt(pos.target_1)}</span>
          <span style={{ color: "var(--muted)", marginLeft: "4px" }}>t2 </span>
          <span style={{ color: "var(--text)" }}>₹{fmt(pos.target_2)}</span>
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>qty  </span>
          <span style={{ color: "var(--text)" }}>{pos.quantity}</span>
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>conv  </span>
          <span style={{ color: "var(--text)" }}>{pos.conviction?.toFixed(1) ?? "—"}</span>
        </div>
        {(pos.hold_days_min != null || pos.hold_days_max != null) && (
          <div className="col-span-2">
            <span style={{ color: "var(--muted)" }}>hold  </span>
            <span style={{ color: "var(--text)" }}>{pos.hold_days_min}–{pos.hold_days_max}d</span>
          </div>
        )}
      </div>

      {pos.thesis && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{ color: "var(--accent)", fontSize: "10px", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
          >
            {expanded ? "▼ thesis" : "▶ thesis"}
          </button>
          {expanded && (
            <div
              className="mt-1 p-2"
              style={{ color: "var(--muted)", fontSize: "10px", lineHeight: 1.6, background: "var(--bg)", borderRadius: "2px" }}
            >
              {pos.thesis}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScanRow({ row }: { row: BotScanResult }) {
  const [expanded, setExpanded] = useState(false);
  const actionColor = row.action === "BOUGHT" ? "var(--up)" : row.action === "DISQUALIFIED" ? "var(--down)" : "var(--muted)";
  const actionLabel = row.action === "BOUGHT" ? "✓ BOUGHT" : row.action === "DISQUALIFIED" ? "✗ DISQ" : "✗ SKIP";

  return (
    <>
      <tr
        style={{ borderBottom: "1px solid var(--border)", cursor: row.llm_thesis ? "pointer" : "default" }}
        onClick={() => row.llm_thesis && setExpanded((e) => !e)}
      >
        <td className="py-2 px-3" style={{ color: "var(--accent)", fontFamily: "var(--font-geist-mono)", fontSize: "12px", fontWeight: 700 }}>
          {row.ticker}
        </td>
        <td className="py-2 px-3" style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>
          {row.fundamental_score?.toFixed(0) ?? "—"}
        </td>
        <td className="py-2 px-3" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>
          {row.tier ?? "—"}
        </td>
        <td className="py-2 px-3" style={{ color: actionColor, fontFamily: "var(--font-geist-mono)", fontSize: "11px", fontWeight: 600 }}>
          {actionLabel}
        </td>
        <td className="py-2 px-3" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>
          {row.conviction?.toFixed(1) ?? "—"}
        </td>
        <td className="py-2 px-3" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>
          {row.skip_reason ?? (row.llm_thesis ? <span style={{ color: "var(--accent)" }}>[why]</span> : "—")}
        </td>
      </tr>
      {expanded && row.llm_thesis && (
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <td colSpan={6} className="px-3 py-2">
            <div style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px", lineHeight: 1.6, background: "var(--bg)", padding: "8px", borderRadius: "2px" }}>
              {row.llm_thesis}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function LogRow({ entry }: { entry: BotLogEntry }) {
  const color =
    entry.level === "TRADE" ? "var(--up)" :
    entry.level === "WARNING" ? "#f59e0b" :
    entry.level === "ERROR" ? "var(--down)" :
    "var(--muted)";

  return (
    <div className="flex gap-3 px-3 py-1.5" style={{ borderBottom: "1px solid var(--border)", fontSize: "11px", fontFamily: "var(--font-geist-mono)" }}>
      <span style={{ color: "var(--muted)", flexShrink: 0 }}>{fmtTime(entry.timestamp)}</span>
      <span style={{ color, fontWeight: entry.level === "TRADE" ? 700 : 400, flexShrink: 0, minWidth: "52px" }}>{entry.level}</span>
      <span style={{ color: "var(--text)" }}>{entry.message}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BotPage() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [positions, setPositions] = useState<BotPosition[]>([]);
  const [scanResults, setScanResults] = useState<BotScanResult[]>([]);
  const [logs, setLogs] = useState<BotLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      const [st, pos, scan, lg] = await Promise.all([
        api.getBotStatus(signal),
        api.getBotPositions(signal),
        api.getBotScanResults("today", signal),
        api.getBotLogs(50, signal),
      ]);
      setStatus(st);
      setPositions(pos);
      setScanResults(scan);
      setLogs(lg);
    } catch {
      // aborted or server down — keep stale data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [refresh]);

  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });

  return (
    <TerminalShell>
      <div className="flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
        {/* Page header */}
        <div
          className="flex items-center justify-between px-5 py-2.5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span className="text-xs font-semibold tracking-widest" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
            BOT_MONITOR
          </span>
          <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}>
            auto-refresh 30s
          </span>
        </div>

        {/* Status bar */}
        <StatusBar status={status} loading={loading} />

        {/* Two-column layout on desktop */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0">
          {/* Left: open positions */}
          <div
            className="flex flex-col md:w-72 lg:w-80 flex-shrink-0"
            style={{ borderRight: "1px solid var(--border)" }}
          >
            <div className="px-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px", letterSpacing: "0.08em" }}>
                OPEN POSITIONS ({positions.length})
              </span>
            </div>
            <div className="flex-1 overflow-auto p-3 flex flex-col gap-3">
              {positions.length === 0 ? (
                <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px", padding: "8px" }}>
                  no open positions
                </span>
              ) : (
                positions.map((p) => <PositionCard key={p.id} pos={p} />)
              )}
            </div>
          </div>

          {/* Right: scan table + log */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            {/* Morning scan */}
            <div style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="px-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px", letterSpacing: "0.08em" }}>
                  MORNING SCAN — {today} ({scanResults.length} stocks)
                </span>
              </div>
              <div className="overflow-x-auto" style={{ maxHeight: "260px", overflowY: "auto" }}>
                {scanResults.length === 0 ? (
                  <div className="px-4 py-3" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>
                    no scan data yet today
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["TICKER", "SCORE", "TIER", "ACTION", "CONV", "REASON"].map((h) => (
                          <th key={h} className="px-3 py-1.5 text-left" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "9px", letterSpacing: "0.08em", fontWeight: 600 }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scanResults.map((r) => <ScanRow key={r.id} row={r} />)}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Live log */}
            <div className="flex flex-col flex-1 min-h-0">
              <div className="px-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px", letterSpacing: "0.08em" }}>
                  LIVE LOG
                </span>
              </div>
              <div className="flex-1 overflow-auto" style={{ minHeight: "120px" }}>
                {logs.length === 0 ? (
                  <div className="px-4 py-3" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>
                    no log entries yet
                  </div>
                ) : (
                  logs.map((l) => <LogRow key={l.id} entry={l} />)
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </TerminalShell>
  );
}
