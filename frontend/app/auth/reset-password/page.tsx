"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (!error) setReady(true);
      });
    } else {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
      });
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) setReady(true);
      });
      return () => subscription.unsubscribe();
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.replace("/dashboard");
    }
  };

  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <span style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: "0.875rem" }}>verifying link...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: "380px" }}>
        <div className="mb-8 text-center">
          <div style={{ fontFamily: "var(--font-geist-mono)", color: "var(--accent)", fontWeight: 900, fontSize: "2rem", letterSpacing: "0.12em", marginBottom: "0.25rem" }}>
            TRADIO
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "var(--font-geist-mono)" }}>
            set a new password
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={{ display: "block", fontSize: "10px", fontFamily: "var(--font-geist-mono)", color: "var(--muted)", letterSpacing: "0.1em", marginBottom: "6px" }}>
              NEW PASSWORD
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min 6 characters"
              style={{ width: "100%", padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: "2px", color: "var(--text)", fontSize: "13px", fontFamily: "var(--font-geist-mono)", outline: "none", boxSizing: "border-box" }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-2)")}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "10px", fontFamily: "var(--font-geist-mono)", color: "var(--muted)", letterSpacing: "0.1em", marginBottom: "6px" }}>
              CONFIRM PASSWORD
            </label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              style={{ width: "100%", padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: "2px", color: "var(--text)", fontSize: "13px", fontFamily: "var(--font-geist-mono)", outline: "none", boxSizing: "border-box" }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-2)")}
            />
          </div>

          {error && <p style={{ color: "var(--down)", fontSize: "12px", fontFamily: "var(--font-geist-mono)" }}>{error}</p>}

          <button
            type="submit"
            disabled={loading}
            style={{ width: "100%", padding: "11px", marginTop: "4px", background: loading ? "var(--muted)" : "var(--accent)", color: "var(--accent-text)", border: "none", borderRadius: "2px", fontSize: "12px", fontWeight: 700, fontFamily: "var(--font-geist-mono)", letterSpacing: "0.08em", cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading ? "updating..." : "_SET_PASSWORD"}
          </button>
        </form>
      </div>
    </div>
  );
}
