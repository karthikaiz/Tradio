"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { useTrading } from "@/lib/trading-context";
import AnimatedNumber from "./ui/AnimatedNumber";

const fmtIdx = (v: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);

const fmtBal = (v: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);

interface IndexData { value: number; change: number; changePct: number }

const INDICES = [
  { label: "NIFTY 50", ticker: "^NSEI" },
  { label: "SENSEX",   ticker: "^BSESN" },
  { label: "BANK NIFTY", ticker: "^NSEBANK" },
];

function useIndices() {
  const [data, setData] = useState<Record<string, IndexData>>({});
  const baselineRef = useRef<Record<string, number>>({});

  const fetch = useCallback(async () => {
    try {
      const tickers = INDICES.map((i) => i.ticker);
      const res = await api.getMultiPrice(tickers);
      const updated: Record<string, IndexData> = {};
      for (const idx of INDICES) {
        const entry = res.prices[idx.ticker];
        if (!entry?.price) continue;
        if (!baselineRef.current[idx.ticker]) baselineRef.current[idx.ticker] = entry.price;
        const baseline = baselineRef.current[idx.ticker];
        const change = entry.price - baseline;
        updated[idx.ticker] = { value: entry.price, change, changePct: (change / baseline) * 100 };
      }
      if (Object.keys(updated).length) setData((prev) => ({ ...prev, ...updated }));
    } catch {
      // silently ignore — indices might not be supported
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 60000);
    return () => clearInterval(id);
  }, [fetch]);

  return data;
}

function SearchBar() {
  const router = useRouter();
  const { addToWatchlist } = useTrading();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ ticker: string; name: string }[]>([]);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!query.trim() || query.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const { results: r } = await api.searchTickers(query, abortRef.current.signal);
        setResults(r.slice(0, 7));
      } catch { /* */ }
      finally { setLoading(false); }
    }, 300);
  }, [query]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false); setResults([]); setQuery("");
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const select = (ticker: string) => {
    router.push(`/stock/${ticker}`);
    setQuery(""); setResults([]); setFocused(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div
        className="flex items-center gap-2 px-3"
        style={{
          height: "30px",
          width: "200px",
          background: "var(--bg)",
          border: `1px solid ${focused ? "var(--accent)" : "var(--border-2)"}`,
          borderRadius: "2px",
          transition: "border-color 0.15s",
        }}
      >
        <span
          style={{ color: "var(--accent)", fontSize: "12px", fontFamily: "var(--font-geist-mono)", lineHeight: 1 }}
        >›</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="TICKER OR COMMAND"
          className="flex-1 bg-transparent focus:outline-none"
          style={{
            fontSize: "11px",
            fontFamily: "var(--font-geist-mono)",
            color: "var(--text)",
            letterSpacing: "0.05em",
          }}
        />
        {loading && (
          <span style={{ color: "var(--muted)", fontSize: "10px", fontFamily: "var(--font-geist-mono)" }}>...</span>
        )}
      </div>

      <AnimatePresence>
        {focused && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full left-0 z-50 mt-1 overflow-hidden"
            style={{
              width: "280px",
              background: "var(--surface)",
              border: "1px solid var(--border-2)",
              borderRadius: "2px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            {results.map((r) => (
              <div
                key={r.ticker}
                onMouseDown={(e) => { e.preventDefault(); select(r.ticker); }}
                className="flex items-center justify-between px-3 py-2 cursor-pointer group"
                style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div className="min-w-0">
                  <span
                    className="font-bold text-xs"
                    style={{ color: "var(--accent)", fontFamily: "var(--font-geist-mono)" }}
                  >
                    {r.ticker}
                  </span>
                  <span className="text-xs ml-2 truncate" style={{ color: "var(--muted)" }}>{r.name}</span>
                </div>
                <button
                  onMouseDown={(e) => {
                    e.stopPropagation(); e.preventDefault();
                    addToWatchlist(r.ticker);
                    setQuery(""); setResults([]); setFocused(false);
                  }}
                  className="ml-2 flex-shrink-0 text-xs px-1.5 py-0.5 transition-colors"
                  style={{
                    color: "var(--accent)",
                    border: "1px solid var(--accent-dim)",
                    borderRadius: "2px",
                    fontFamily: "var(--font-geist-mono)",
                  }}
                >
                  +WATCH
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAutoUsername(username: string) {
  return UUID_RE.test(username) || (username.length <= 50 && /^[0-9a-f-]{36}/.test(username));
}

export default function Navbar() {
  const { isSignedIn, user, signOut, getToken } = useAuth();
  const { portfolio } = useTrading();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Fetch profile to get username and prompt if it's auto-generated
  useEffect(() => {
    if (!isSignedIn) { setDisplayName(null); return; }
    getToken().then(async (token) => {
      if (!token) return;
      try {
        const { username } = await api.getProfile(token);
        setDisplayName(username);
        if (isAutoUsername(username)) setShowUsernameModal(true);
      } catch {}
    });
  }, [isSignedIn, getToken]);

  const handleSaveUsername = async () => {
    const name = usernameInput.trim();
    if (!name) return;
    setUsernameError("");
    setUsernameLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const { username } = await api.updateUsername(name, token);
      setDisplayName(username);
      setShowUsernameModal(false);
      setUsernameInput("");
    } catch (e: unknown) {
      setUsernameError(e instanceof Error ? e.message : "Failed to save username");
    } finally {
      setUsernameLoading(false);
    }
  };

  return (
    <>
    {/* Username setup modal */}
    {showUsernameModal && (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.7)" }}
      >
        <div
          className="p-6 flex flex-col gap-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-2)",
            borderRadius: "2px",
            width: "320px",
            boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
          }}
        >
          <div>
            <div style={{ color: "var(--accent)", fontFamily: "var(--font-geist-mono)", fontSize: "11px", letterSpacing: "0.08em", fontWeight: 700 }}>
              SET_DISPLAY_NAME
            </div>
            <div style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "11px", marginTop: 4 }}>
              Choose a name for your Tradio profile
            </div>
          </div>
          <input
            type="text"
            value={usernameInput}
            onChange={(e) => { setUsernameInput(e.target.value); setUsernameError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleSaveUsername()}
            placeholder="e.g. trader_hawk"
            maxLength={20}
            autoFocus
            className="bg-transparent focus:outline-none w-full pb-1"
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: "14px",
              color: "var(--text)",
              borderBottom: "1px solid var(--accent)",
              letterSpacing: "0.05em",
            }}
          />
          {usernameError && (
            <span style={{ color: "var(--down)", fontFamily: "var(--font-geist-mono)", fontSize: "11px" }}>
              {usernameError}
            </span>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSaveUsername}
              disabled={usernameLoading || !usernameInput.trim()}
              className="flex-1 py-2 text-xs font-bold tracking-widest"
              style={{
                fontFamily: "var(--font-geist-mono)",
                background: usernameLoading || !usernameInput.trim() ? "var(--surface-2)" : "var(--accent)",
                color: usernameLoading || !usernameInput.trim() ? "var(--muted)" : "var(--bg)",
                border: "none",
                borderRadius: "2px",
                cursor: usernameLoading || !usernameInput.trim() ? "not-allowed" : "pointer",
              }}
            >
              {usernameLoading ? "SAVING..." : "_CONFIRM"}
            </button>
            <button
              onClick={() => setShowUsernameModal(false)}
              className="px-4 py-2 text-xs"
              style={{
                fontFamily: "var(--font-geist-mono)",
                background: "transparent",
                color: "var(--muted)",
                border: "1px solid var(--border-2)",
                borderRadius: "2px",
                cursor: "pointer",
              }}
            >
              SKIP
            </button>
          </div>
        </div>
      </div>
    )}
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center px-4 gap-4"
      style={{
        height: "56px",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        fontFamily: "var(--font-geist-mono)",
      }}
    >
      {/* Logo */}
      <Link href={isSignedIn ? "/dashboard" : "/"} className="flex-shrink-0 mr-2">
        <span
          className="font-black tracking-widest text-sm"
          style={{ color: "var(--accent)" }}
        >
          TR
        </span>
      </Link>


      {/* Search — desktop only */}
      {isSignedIn && (
        <div className="hidden md:block flex-1 max-w-xs">
          <SearchBar />
        </div>
      )}

      {/* Auth */}
      <div className="flex items-center gap-2 ml-auto flex-shrink-0">
        {isSignedIn ? (
          <>
            {portfolio && (
              <div
                className="hidden sm:flex items-center gap-1 px-2 py-1"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border-2)",
                  borderRadius: "2px",
                  fontSize: "11px",
                }}
              >
                <span style={{ color: "var(--muted)" }}>₹</span>
                <AnimatedNumber
                  value={portfolio.available_balance}
                  format={fmtBal}
                  style={{ color: "var(--text)", fontFamily: "var(--font-geist-mono)", fontWeight: 600 }}
                />
              </div>
            )}
            <div ref={menuRef} style={{ position: "relative" }}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                style={{
                  color: "var(--muted)",
                  border: "1px solid var(--border-2)",
                  borderRadius: "2px",
                  fontFamily: "var(--font-geist-mono)",
                  letterSpacing: "0.05em",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: 600,
                  padding: "4px 8px",
                }}
              >
                {displayName && !isAutoUsername(displayName)
                ? displayName.toUpperCase()
                : user?.email?.split("@")[0]?.toUpperCase() ?? "ACCOUNT"}
              </button>
              {menuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    background: "var(--surface)",
                    border: "1px solid var(--border-2)",
                    borderRadius: "2px",
                    minWidth: "160px",
                    zIndex: 100,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                  }}
                >
                  <div
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "11px",
                      color: "var(--muted)",
                      fontFamily: "var(--font-geist-mono)",
                    }}
                  >
                    {user?.email}
                  </div>
                  <button
                    onClick={() => { setMenuOpen(false); setShowUsernameModal(true); }}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--text)",
                      fontFamily: "var(--font-geist-mono)",
                      fontSize: "12px",
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    set username
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); signOut(); }}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      background: "transparent",
                      border: "none",
                      color: "var(--down)",
                      fontFamily: "var(--font-geist-mono)",
                      fontSize: "12px",
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    sign out
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <Link
            href="/sign-in"
            className="text-xs font-bold px-3 py-1.5 transition-opacity hover:opacity-80"
            style={{
              color: "var(--accent-text)",
              background: "var(--accent)",
              borderRadius: "2px",
              fontFamily: "var(--font-geist-mono)",
              letterSpacing: "0.05em",
            }}
          >
            _SIGN_IN
          </Link>
        )}
      </div>
    </header>
    </>
  );
}
