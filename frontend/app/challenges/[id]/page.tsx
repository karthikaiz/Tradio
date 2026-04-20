"use client";

import { useState, useEffect, useRef, use, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, ChallengeInfo, ChallengeLeaderboardEntry, ChallengePortfolio, OrderRecord, ApiError } from "@/lib/api";
import TerminalShell from "@/components/TerminalShell";
import SearchBox from "@/components/SearchBox";

interface Props { params: Promise<{ id: string }> }

const fmtINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

const fmtINR2 = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

const sign = (v: number) => (v >= 0 ? "+" : "");

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });

const STATUS_COLOR: Record<string, string> = {
  active: "var(--up)",
  upcoming: "var(--accent)",
  ended: "var(--muted)",
};

function displayName(username: string) {
  if (username.length > 16) return username.slice(0, 8) + "…" + username.slice(-4);
  return username;
}

interface Toast { id: number; message: string; type: "success" | "error" }
let toastId = 0;

export default function ChallengePage({ params }: Props) {
  const { id: rawId } = use(params);
  const challengeId = parseInt(rawId);
  const { isSignedIn, getToken, user } = useAuth();

  const [challenge, setChallenge] = useState<ChallengeInfo | null>(null);
  const [joined, setJoined] = useState(false);
  const [leaderboard, setLeaderboard] = useState<ChallengeLeaderboardEntry[]>([]);
  const [portfolio, setPortfolio] = useState<ChallengePortfolio | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [tab, setTab] = useState<"LEADERBOARD" | "HOLDINGS" | "ORDERS">("LEADERBOARD");
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Trade form state
  const [ticker, setTicker] = useState("");
  const [tickerName, setTickerName] = useState("");
  const [qty, setQty] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [submitting, setSubmitting] = useState(false);
  const [tradePrice, setTradePrice] = useState<number | null>(null);
  const priceAbort = useRef<AbortController | null>(null);

  const addToast = useCallback((message: string, type: "success" | "error") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  useEffect(() => {
    if (isSignedIn) {
      getToken().then(setToken).catch(() => {});
    }
  }, [isSignedIn, getToken]);

  // Load challenge info
  useEffect(() => {
    setLoading(true);
    api.getChallenge(challengeId)
      .then(setChallenge)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [challengeId]);

  // Check joined status + load leaderboard
  const refreshLeaderboard = useCallback(() => {
    api.challengeLeaderboard(challengeId)
      .then((data) => setLeaderboard(data.entries))
      .catch(() => {});
  }, [challengeId]);

  const refreshPortfolio = useCallback(() => {
    if (!token) return;
    api.challengePortfolio(challengeId, token)
      .then(setPortfolio)
      .catch(() => {});
    api.challengeOrders(challengeId, token)
      .then(setOrders)
      .catch(() => {});
  }, [challengeId, token]);

  useEffect(() => {
    refreshLeaderboard();
  }, [refreshLeaderboard]);

  useEffect(() => {
    if (!token) return;
    api.challengeMe(challengeId, token)
      .then((data) => {
        setJoined(data.joined);
        if (data.joined) refreshPortfolio();
      })
      .catch(() => {});
  }, [challengeId, token, refreshPortfolio]);

  // Fetch price for trade ticker
  useEffect(() => {
    if (!ticker || ticker.length < 1) { setTradePrice(null); return; }
    priceAbort.current?.abort();
    priceAbort.current = new AbortController();
    const t = ticker.toUpperCase();
    api.getPrice(t, priceAbort.current.signal)
      .then((d) => setTradePrice(d.price))
      .catch(() => setTradePrice(null));
    return () => priceAbort.current?.abort();
  }, [ticker]);

  const handleJoin = async () => {
    if (!token || !challenge) return;
    setJoining(true);
    try {
      await api.joinChallenge(challengeId, token);
      setJoined(true);
      refreshLeaderboard();
      refreshPortfolio();
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : "Failed to join", "error");
    } finally {
      setJoining(false);
    }
  };

  const handleTrade = async () => {
    if (!token || !ticker.trim() || !qty) return;
    const qtyInt = parseInt(qty);
    if (!qtyInt || qtyInt <= 0) return;
    setSubmitting(true);
    try {
      const sym = ticker.toUpperCase().trim();
      if (side === "BUY") {
        const r = await api.challengeBuy(challengeId, sym, qtyInt, token);
        addToast(`BOUGHT ${qtyInt} ${sym} @ ${fmtINR2(r.execution_price)}`, "success");
      } else {
        const r = await api.challengeSell(challengeId, sym, qtyInt, token);
        const pnl = r.realized_pnl;
        const pnlStr = pnl !== undefined ? `  P&L: ${pnl >= 0 ? "+" : ""}${fmtINR2(pnl)}` : "";
        addToast(`SOLD ${qtyInt} ${sym} @ ${fmtINR2(r.execution_price)}${pnlStr}`, "success");
      }
      setQty("");
      setTicker("");
      setTickerName("");
      refreshLeaderboard();
      refreshPortfolio();
    } catch (err: unknown) {
      const msg = err instanceof ApiError
        ? (err.detail?.error as string ?? err.message)
        : err instanceof Error ? err.message : "Trade failed";
      addToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const myUsername = user?.id ? user.id.slice(0, 50) : null;
  const isActive = challenge?.status === "active";
  const qtyInt = parseInt(qty);
  const estimated = tradePrice && qtyInt > 0 ? tradePrice * qtyInt : null;
  const challengeBalance = portfolio?.available_balance ?? null;
  const myHolding = portfolio?.holdings.find((h) => h.ticker === ticker.toUpperCase());
  const maxSell = myHolding?.quantity ?? 0;
  const canTrade = joined && isActive && !submitting && ticker.trim().length > 0 && qtyInt > 0 && (side === "BUY" || maxSell > 0);

  const thStyle: React.CSSProperties = {
    color: "var(--muted)",
    fontFamily: "var(--font-geist-mono)",
    fontSize: "10px",
    letterSpacing: "0.08em",
    fontWeight: 600,
    padding: "5px 10px",
    textAlign: "left",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "11px",
    padding: "7px 10px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text)",
    whiteSpace: "nowrap",
  };

  if (loading) {
    return (
      <TerminalShell>
        <div className="flex items-center justify-center h-40">
          <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "12px" }}>
            LOADING...
          </span>
        </div>
      </TerminalShell>
    );
  }

  if (!challenge) {
    return (
      <TerminalShell>
        <div className="flex items-center justify-center h-40">
          <span style={{ color: "var(--down)", fontFamily: "var(--font-geist-mono)", fontSize: "12px" }}>
            CHALLENGE_NOT_FOUND
          </span>
        </div>
      </TerminalShell>
    );
  }

  return (
    <TerminalShell>
      {/* Toast notifications */}
      <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 pointer-events-none" style={{ maxWidth: "320px" }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: "10px 14px",
              background: t.type === "success" ? "var(--surface)" : "var(--surface)",
              border: `1px solid ${t.type === "success" ? "var(--up)" : "var(--down)"}`,
              borderRadius: "2px",
              color: t.type === "success" ? "var(--up)" : "var(--down)",
              fontFamily: "var(--font-geist-mono)",
              fontSize: "11px",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>

      <div className="flex flex-col" style={{ height: "calc(100vh - 92px)" }}>
        {/* Challenge header */}
        <div
          className="px-5 py-3 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: "14px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
                {challenge.name}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span style={{ color: STATUS_COLOR[challenge.status], fontFamily: "var(--font-geist-mono)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em" }}>
                  {challenge.status.toUpperCase()}
                </span>
                <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}>
                  {fmtINR(challenge.starting_balance)} START
                </span>
                <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}>
                  {challenge.participant_count} TRADER{challenge.participant_count !== 1 ? "S" : ""}
                </span>
                <span className="hidden md:inline" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}>
                  ENDS {fmtDate(challenge.end_date)}
                </span>
              </div>
            </div>

            {isSignedIn && !joined && challenge.status !== "ended" && (
              <button
                onClick={handleJoin}
                disabled={joining}
                style={{
                  padding: "8px 16px",
                  background: joining ? "var(--muted)" : "var(--accent)",
                  border: "none",
                  borderRadius: "2px",
                  color: "var(--accent-text)",
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "var(--font-geist-mono)",
                  letterSpacing: "0.08em",
                  cursor: joining ? "not-allowed" : "pointer",
                  flexShrink: 0,
                }}
              >
                {joining ? "JOINING..." : "JOIN"}
              </button>
            )}

            {joined && (
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "9px", letterSpacing: "0.08em" }}>BALANCE</div>
                <div style={{ color: "var(--accent)", fontFamily: "var(--font-geist-mono)", fontSize: "13px", fontWeight: 700 }}>
                  {challengeBalance !== null ? fmtINR(challengeBalance) : "—"}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Body: leaderboard + trade panel */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Left: tabs + table */}
          <div className="flex flex-col flex-1 md:border-r overflow-hidden" style={{ borderColor: "var(--border)" }}>
            {/* Tab bar */}
            <div className="flex border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              {(["LEADERBOARD", "HOLDINGS", "ORDERS"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); if (t !== "LEADERBOARD" && joined && token) refreshPortfolio(); }}
                  style={{
                    padding: "8px 14px",
                    background: "transparent",
                    border: "none",
                    borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                    color: tab === t ? "var(--accent)" : "var(--muted)",
                    fontFamily: "var(--font-geist-mono)",
                    fontSize: "10px",
                    letterSpacing: "0.08em",
                    cursor: "pointer",
                    fontWeight: tab === t ? 700 : 400,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto">
              {tab === "LEADERBOARD" && (
                leaderboard.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>NO_PARTICIPANTS_YET</span>
                  </div>
                ) : (
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, width: "40px" }}>#</th>
                        <th style={thStyle}>TRADER</th>
                        <th className="hidden md:table-cell" style={{ ...thStyle, textAlign: "right" }}>VALUE</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>RETURN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((e) => {
                        const isMe = myUsername !== null && e.username === myUsername;
                        const pnlColor = e.total_pnl >= 0 ? "var(--up)" : "var(--down)";
                        return (
                          <tr key={e.rank} style={{ background: isMe ? "var(--accent-dim)" : "transparent", borderLeft: isMe ? "2px solid var(--accent)" : "2px solid transparent" }}>
                            <td style={{ ...tdStyle, color: e.rank <= 3 ? "var(--accent)" : "var(--muted)", fontWeight: e.rank <= 3 ? 700 : 400 }}>
                              {String(e.rank).padStart(2, "0")}
                            </td>
                            <td style={{ ...tdStyle, maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                              <span style={{ color: isMe ? "var(--accent)" : "var(--text)" }}>
                                {displayName(e.username)}
                                {isMe && <span style={{ color: "var(--accent)", marginLeft: 5, fontSize: "9px" }}>YOU</span>}
                              </span>
                            </td>
                            <td className="hidden md:table-cell" style={{ ...tdStyle, textAlign: "right", color: "var(--muted)" }}>
                              {fmtINR(e.total_value)}
                            </td>
                            <td style={{ ...tdStyle, textAlign: "right", color: pnlColor, fontWeight: 600 }}>
                              {sign(e.total_pnl_pct)}{e.total_pnl_pct.toFixed(2)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              )}

              {tab === "HOLDINGS" && (
                !joined ? (
                  <div className="flex items-center justify-center h-32">
                    <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>JOIN_TO_VIEW</span>
                  </div>
                ) : !portfolio || portfolio.holdings.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>NO_HOLDINGS</span>
                  </div>
                ) : (
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th style={thStyle}>TICKER</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>QTY</th>
                        <th className="hidden md:table-cell" style={{ ...thStyle, textAlign: "right" }}>AVG</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.holdings.map((h) => {
                        const pnl = h.unrealized_pnl ?? 0;
                        const pnlColor = pnl >= 0 ? "var(--up)" : "var(--down)";
                        return (
                          <tr
                            key={h.ticker}
                            style={{ cursor: "pointer" }}
                            onClick={() => { setTicker(h.ticker); setTickerName(""); setSide("SELL"); }}
                          >
                            <td style={{ ...tdStyle, color: "var(--accent)" }}>{h.ticker}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>{h.quantity}</td>
                            <td className="hidden md:table-cell" style={{ ...tdStyle, textAlign: "right", color: "var(--muted)" }}>{fmtINR2(h.avg_buy_price)}</td>
                            <td style={{ ...tdStyle, textAlign: "right", color: pnlColor, fontWeight: 600 }}>
                              {h.unrealized_pnl !== null ? `${sign(h.unrealized_pnl)}${fmtINR2(h.unrealized_pnl)}` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              )}

              {tab === "ORDERS" && (
                !joined ? (
                  <div className="flex items-center justify-center h-32">
                    <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>JOIN_TO_VIEW</span>
                  </div>
                ) : orders.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>NO_ORDERS</span>
                  </div>
                ) : (
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th style={thStyle}>TICKER</th>
                        <th style={thStyle}>SIDE</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>QTY</th>
                        <th className="hidden md:table-cell" style={{ ...thStyle, textAlign: "right" }}>PRICE</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.order_id}>
                          <td style={{ ...tdStyle, color: "var(--accent)" }}>{o.ticker}</td>
                          <td style={{ ...tdStyle, color: o.side === "BUY" ? "var(--up)" : "var(--down)", fontWeight: 600 }}>{o.side}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{o.quantity}</td>
                          <td className="hidden md:table-cell" style={{ ...tdStyle, textAlign: "right", color: "var(--muted)" }}>{fmtINR2(o.execution_price)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: o.realized_pnl !== null && o.realized_pnl >= 0 ? "var(--up)" : "var(--down)" }}>
                            {o.realized_pnl !== null ? `${sign(o.realized_pnl)}${fmtINR2(o.realized_pnl)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </div>
          </div>

          {/* Right: trade form */}
          <div
            className="flex-shrink-0 border-t md:border-t-0"
            style={{ width: "100%", maxWidth: "100%", borderColor: "var(--border)" }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: "280px",
                margin: "0 auto",
                padding: "16px",
              }}
            >
              {!isSignedIn ? (
                <p style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px", textAlign: "center" }}>
                  sign in to trade
                </p>
              ) : !joined ? (
                <div style={{ textAlign: "center" }}>
                  <p style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px", marginBottom: "12px" }}>
                    join to start trading
                  </p>
                  {challenge.status !== "ended" && (
                    <button
                      onClick={handleJoin}
                      disabled={joining}
                      style={{
                        padding: "9px 20px",
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: "2px",
                        color: "var(--accent-text)",
                        fontSize: "11px",
                        fontWeight: 700,
                        fontFamily: "var(--font-geist-mono)",
                        cursor: joining ? "not-allowed" : "pointer",
                      }}
                    >
                      {joining ? "JOINING..." : "JOIN"}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: "10px", color: "var(--muted)", letterSpacing: "0.08em", marginBottom: "2px" }}>
                    CHALLENGE_TRADE
                  </div>

                  {/* BUY / SELL tabs */}
                  <div style={{ display: "flex", gap: "6px" }}>
                    {(["BUY", "SELL"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setSide(s)}
                        style={{
                          flex: 1,
                          padding: "6px",
                          background: side === s ? (s === "BUY" ? "var(--up)" : "var(--down)") : "transparent",
                          border: `1px solid ${s === "BUY" ? "var(--up)" : "var(--down)"}`,
                          borderRadius: "2px",
                          color: side === s ? "#fff" : s === "BUY" ? "var(--up)" : "var(--down)",
                          fontFamily: "var(--font-geist-mono)",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>

                  {/* Stock search */}
                  <div>
                    <label style={{ display: "block", fontSize: "10px", fontFamily: "var(--font-geist-mono)", color: "var(--muted)", letterSpacing: "0.08em", marginBottom: "5px" }}>STOCK</label>
                    {ticker ? (
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        background: "var(--surface)",
                        border: "1px solid var(--accent)",
                        borderRadius: "2px",
                        boxSizing: "border-box",
                      }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-geist-mono)" }}>{ticker}</div>
                          {tickerName && <div style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "var(--font-geist-mono)", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tickerName}</div>}
                        </div>
                        <button
                          onClick={() => { setTicker(""); setTickerName(""); setTradePrice(null); }}
                          style={{ color: "var(--muted)", fontSize: "12px", background: "none", border: "none", cursor: "pointer", flexShrink: 0, paddingLeft: "8px" }}
                        >✕</button>
                      </div>
                    ) : (
                      <SearchBox
                        placeholder="Search stock name…"
                        compact
                        onSelect={(t, name) => { setTicker(t); setTickerName(name || t); }}
                      />
                    )}
                  </div>

                  {/* Quantity */}
                  <div>
                    <label style={{ display: "block", fontSize: "10px", fontFamily: "var(--font-geist-mono)", color: "var(--muted)", letterSpacing: "0.08em", marginBottom: "5px" }}>QUANTITY</label>
                    <input
                      type="number"
                      min={1}
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder="0"
                      disabled={!isActive}
                      style={{
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
                      }}
                      onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                      onBlur={(e) => (e.target.style.borderColor = "var(--border-2)")}
                    />
                  </div>

                  {/* Price estimate */}
                  {ticker && tradePrice !== null && (
                    <div style={{ fontSize: "10px", fontFamily: "var(--font-geist-mono)", color: "var(--muted)" }}>
                      <span>@ {fmtINR2(tradePrice)}</span>
                      {estimated && <span style={{ marginLeft: "8px", color: "var(--text)" }}>≈ {fmtINR(estimated)}</span>}
                    </div>
                  )}
                  {side === "SELL" && ticker && maxSell > 0 && (
                    <div style={{ fontSize: "10px", fontFamily: "var(--font-geist-mono)", color: "var(--muted)" }}>
                      holding: {maxSell} shares
                    </div>
                  )}

                  {!isActive && (
                    <p style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "10px" }}>
                      {challenge.status === "ended" ? "CHALLENGE ENDED" : "CHALLENGE NOT STARTED"}
                    </p>
                  )}

                  <button
                    onClick={handleTrade}
                    disabled={!canTrade}
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: !canTrade ? "var(--muted)" : side === "BUY" ? "var(--up)" : "var(--down)",
                      border: "none",
                      borderRadius: "2px",
                      color: "#fff",
                      fontFamily: "var(--font-geist-mono)",
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      cursor: canTrade ? "pointer" : "not-allowed",
                    }}
                  >
                    {submitting ? "PROCESSING..." : `_${side}`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </TerminalShell>
  );
}
