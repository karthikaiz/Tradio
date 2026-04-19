"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, ChallengeInfo } from "@/lib/api";
import TerminalShell from "@/components/TerminalShell";

const fmtINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

const STATUS_COLOR: Record<string, string> = {
  active: "var(--up)",
  upcoming: "var(--accent)",
  ended: "var(--muted)",
};

function StatusBadge({ status }: { status: ChallengeInfo["status"] }) {
  return (
    <span
      style={{
        color: STATUS_COLOR[status],
        fontFamily: "var(--font-geist-mono)",
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.08em",
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

interface CreateModalProps {
  token: string;
  onClose: () => void;
  onCreated: (c: ChallengeInfo) => void;
}

function CreateModal({ token, onClose, onCreated }: CreateModalProps) {
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("50000");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end <= start) { setError("End date must be after start date"); return; }
    if (end <= new Date()) { setError("End date must be in the future"); return; }

    setLoading(true);
    try {
      const created = await api.createChallenge({
        name,
        starting_balance: parseFloat(balance),
        start_date: start.toISOString(),
        end_date: end.toISOString(),
      }, token);
      onCreated(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create challenge");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    background: "var(--surface)",
    border: "1px solid var(--border-2)",
    borderRadius: "2px",
    color: "var(--text)",
    fontSize: "12px",
    fontFamily: "var(--font-geist-mono)",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "10px",
    fontFamily: "var(--font-geist-mono)",
    color: "var(--muted)",
    letterSpacing: "0.08em",
    marginBottom: "5px",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          background: "var(--bg)",
          border: "1px solid var(--border-2)",
          borderRadius: "4px",
          padding: "24px",
        }}
      >
        <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: "12px", letterSpacing: "0.08em", color: "var(--accent)", marginBottom: "18px", fontWeight: 700 }}>
          CREATE_CHALLENGE
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={labelStyle}>CHALLENGE NAME</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekly Battle"
              maxLength={100}
              style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-2)")}
            />
          </div>

          <div>
            <label style={labelStyle}>STARTING BALANCE (₹)</label>
            <input
              required
              type="number"
              min="1000"
              max="10000000"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-2)")}
            />
          </div>

          <div>
            <label style={labelStyle}>START DATE</label>
            <input
              required
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ ...inputStyle, colorScheme: "dark" }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-2)")}
            />
          </div>

          <div>
            <label style={labelStyle}>END DATE</label>
            <input
              required
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ ...inputStyle, colorScheme: "dark" }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-2)")}
            />
          </div>

          {error && (
            <p style={{ color: "var(--down)", fontSize: "11px", fontFamily: "var(--font-geist-mono)" }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: "9px",
                background: "transparent",
                border: "1px solid var(--border-2)",
                borderRadius: "2px",
                color: "var(--muted)",
                fontSize: "11px",
                fontFamily: "var(--font-geist-mono)",
                cursor: "pointer",
              }}
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 1,
                padding: "9px",
                background: loading ? "var(--muted)" : "var(--accent)",
                border: "none",
                borderRadius: "2px",
                color: "var(--accent-text)",
                fontSize: "11px",
                fontWeight: 700,
                fontFamily: "var(--font-geist-mono)",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "CREATING..." : "_CREATE"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ChallengesPage() {
  const router = useRouter();
  const { isSignedIn, getToken } = useAuth();
  const [challenges, setChallenges] = useState<ChallengeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isSignedIn) {
      getToken().then(setToken).catch(() => {});
    }
  }, [isSignedIn, getToken]);

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    api.listChallenges(ctrl.signal)
      .then((data) => setChallenges(data.challenges))
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, []);

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
    padding: "10px 12px",
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
            TRADING_CHALLENGES
          </span>
          {isSignedIn && token && (
            <button
              onClick={() => setShowCreate(true)}
              style={{
                padding: "5px 12px",
                background: "var(--accent)",
                border: "none",
                borderRadius: "2px",
                color: "var(--accent-text)",
                fontSize: "10px",
                fontWeight: 700,
                fontFamily: "var(--font-geist-mono)",
                letterSpacing: "0.08em",
                cursor: "pointer",
              }}
            >
              + NEW
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 md:overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "12px" }}>
                LOADING_CHALLENGES...
              </span>
            </div>
          ) : challenges.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "12px" }}>
                NO_CHALLENGES_YET
              </span>
              {isSignedIn && token && (
                <button
                  onClick={() => setShowCreate(true)}
                  style={{
                    padding: "7px 16px",
                    background: "transparent",
                    border: "1px solid var(--accent)",
                    borderRadius: "2px",
                    color: "var(--accent)",
                    fontSize: "11px",
                    fontFamily: "var(--font-geist-mono)",
                    cursor: "pointer",
                  }}
                >
                  create the first one
                </button>
              )}
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th style={thStyle}>CHALLENGE</th>
                  <th style={thStyle}>STATUS</th>
                  <th className="hidden md:table-cell" style={{ ...thStyle, textAlign: "right" }}>BALANCE</th>
                  <th className="hidden md:table-cell" style={thStyle}>ENDS</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>TRADERS</th>
                </tr>
              </thead>
              <tbody>
                {challenges.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/challenges/${c.id}`)}
                    style={{ cursor: "pointer" }}
                    className="hover:bg-[var(--surface)]"
                  >
                    <td style={{ ...tdStyle, maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text)" }}>
                      {c.name}
                    </td>
                    <td style={tdStyle}>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="hidden md:table-cell" style={{ ...tdStyle, textAlign: "right", color: "var(--muted)" }}>
                      {fmtINR(c.starting_balance)}
                    </td>
                    <td className="hidden md:table-cell" style={{ ...tdStyle, color: "var(--muted)" }}>
                      {fmtDate(c.end_date)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "var(--muted)" }}>
                      {c.participant_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showCreate && token && (
        <CreateModal
          token={token}
          onClose={() => setShowCreate(false)}
          onCreated={(c) => {
            setChallenges((prev) => [c, ...prev]);
            setShowCreate(false);
            router.push(`/challenges/${c.id}`);
          }}
        />
      )}
    </TerminalShell>
  );
}
