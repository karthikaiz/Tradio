"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setDone(true);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
        <div style={{ textAlign: "center", maxWidth: "380px" }}>
          <div style={{ fontFamily: "var(--font-geist-mono)", color: "var(--accent)", fontWeight: 900, fontSize: "2rem", letterSpacing: "0.12em", marginBottom: "1rem" }}>
            TRADIO
          </div>
          <p style={{ color: "var(--text)", fontSize: "0.9rem", fontFamily: "var(--font-geist-mono)", marginBottom: "0.5rem" }}>
            check your email
          </p>
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "var(--font-geist-mono)", marginBottom: "1.5rem" }}>
            we sent a password reset link to <span style={{ color: "var(--accent)" }}>{email}</span>
          </p>
          <Link href="/sign-in" style={{ color: "var(--muted)", fontSize: "12px", fontFamily: "var(--font-geist-mono)" }}>
            ← back to sign in
          </Link>
        </div>
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
            reset your password
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={{ display: "block", fontSize: "10px", fontFamily: "var(--font-geist-mono)", color: "var(--muted)", letterSpacing: "0.1em", marginBottom: "6px" }}>
              EMAIL
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
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
            {loading ? "sending..." : "_SEND_RESET_LINK"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: "20px", fontSize: "12px", color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
          <Link href="/sign-in" style={{ color: "var(--accent)", textDecoration: "none" }}>← back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
