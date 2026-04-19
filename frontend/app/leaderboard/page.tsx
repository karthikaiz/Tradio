"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, LeaderboardEntry } from "@/lib/api";
import TerminalShell from "@/components/TerminalShell";

const fmtINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

const sign = (v: number) => (v >= 0 ? "+" : "");

function displayName(username: string) {
  if (username.length > 16) return username.slice(0, 8) + "…" + username.slice(-4);
  return username;
}

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    api.getLeaderboard(100, ctrl.signal)
      .then((data) => {
        setEntries(data.entries);
        setTotalUsers(data.total_users);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, []);

  const myUsername = user?.id ? user.id.slice(0, 50) : null;

  const thStyle: React.CSSProperties = {
    color: "var(--muted)",
    fontFamily: "var(--font-geist-mono)",
    fontSize: "10px",
    letterSpacing: "0.08em",
    fontWeight: 600,
    padding: "6px 12px",
    textAlign: "left",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "12px",
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text)",
    whiteSpace: "nowrap",
  };

  return (
    <TerminalShell>
      <div className="flex flex-col md:h-[calc(100vh-92px)] md:overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-2.5 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <span
            className="text-xs font-semibold tracking-widest"
            style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
          >
            GLOBAL_LEADERBOARD
          </span>
          {totalUsers > 0 && (
            <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}>
              {totalUsers} TRADER{totalUsers !== 1 ? "S" : ""}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 md:overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "12px" }}>
                LOADING_RANKINGS...
              </span>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "12px" }}>
                NO_TRADERS_YET
              </span>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: "48px" }}>#</th>
                  <th style={thStyle}>TRADER</th>
                  <th className="hidden md:table-cell" style={{ ...thStyle, textAlign: "right" }}>PORTFOLIO</th>
                  <th className="hidden md:table-cell" style={{ ...thStyle, textAlign: "right" }}>P&amp;L</th>
                  <th style={{ ...thStyle, textAlign: "right", width: "90px" }}>RETURN</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isMe = myUsername !== null && entry.username === myUsername;
                  const pnlColor = entry.total_pnl >= 0 ? "var(--up)" : "var(--down)";
                  return (
                    <tr
                      key={entry.rank}
                      style={{
                        background: isMe ? "var(--accent-dim)" : "transparent",
                        borderLeft: isMe ? "2px solid var(--accent)" : "2px solid transparent",
                      }}
                    >
                      <td style={{ ...tdStyle, color: entry.rank <= 3 ? "var(--accent)" : "var(--muted)", fontWeight: entry.rank <= 3 ? 700 : 400 }}>
                        {String(entry.rank).padStart(2, "0")}
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                        <span style={{ color: isMe ? "var(--accent)" : "var(--text)" }}>
                          {displayName(entry.username)}
                          {isMe && (
                            <span style={{ color: "var(--accent)", marginLeft: 6, fontSize: "9px" }}>YOU</span>
                          )}
                        </span>
                      </td>
                      <td className="hidden md:table-cell" style={{ ...tdStyle, textAlign: "right" }}>
                        {fmtINR(entry.total_value)}
                      </td>
                      <td className="hidden md:table-cell" style={{ ...tdStyle, textAlign: "right", color: pnlColor }}>
                        {sign(entry.total_pnl)}{fmtINR(entry.total_pnl)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", color: pnlColor, fontWeight: 600, width: "90px" }}>
                        {sign(entry.total_pnl_pct)}{entry.total_pnl_pct.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </TerminalShell>
  );
}
