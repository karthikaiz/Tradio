"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else if (data.user?.identities?.length === 0) {
      // Email already registered (via Google or password)
      setError("An account with this email already exists. Please sign in instead.");
      setLoading(false);
    } else if (data.session) {
      // Email confirmation disabled — signed in immediately
      router.replace("/dashboard");
    } else {
      setDone(true);
    }
  };

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
        <div style={{ textAlign: "center", maxWidth: "380px" }}>
          <div
            style={{
              fontFamily: "var(--font-geist-mono)",
              color: "var(--accent)",
              fontWeight: 900,
              fontSize: "2rem",
              letterSpacing: "0.12em",
              marginBottom: "1rem",
            }}
          >
            TRADIO
          </div>
          <p style={{ color: "var(--text)", fontSize: "0.9rem", fontFamily: "var(--font-geist-mono)", marginBottom: "0.5rem" }}>
            check your email
          </p>
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "var(--font-geist-mono)" }}>
            we sent a confirmation link to <span style={{ color: "var(--accent)" }}>{email}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: "380px" }}>
        {/* Header */}
        <div className="mb-8 text-center">
          <div
            style={{
              fontFamily: "var(--font-geist-mono)",
              color: "var(--accent)",
              fontWeight: 900,
              fontSize: "2rem",
              letterSpacing: "0.12em",
              marginBottom: "0.25rem",
            }}
          >
            TRADIO
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "var(--font-geist-mono)" }}>
            create your free account
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSignUp} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={labelStyle}>EMAIL</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-2)")}
            />
          </div>

          <div>
            <label style={labelStyle}>PASSWORD</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="min 6 characters"
                style={{ ...inputStyle, paddingRight: "38px" }}
                onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--border-2)")}
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} style={eyeBtn}>
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>

          <div>
            <label style={labelStyle}>CONFIRM PASSWORD</label>
            <div style={{ position: "relative" }}>
              <input
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                style={{ ...inputStyle, paddingRight: "38px" }}
                onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--border-2)")}
              />
              <button type="button" onClick={() => setShowConfirm((v) => !v)} style={eyeBtn}>
                <EyeIcon open={showConfirm} />
              </button>
            </div>
          </div>

          {error && (
            <p style={{ color: "var(--down)", fontSize: "12px", fontFamily: "var(--font-geist-mono)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px",
              marginTop: "4px",
              background: loading ? "var(--muted)" : "var(--accent)",
              color: "var(--accent-text)",
              border: "none",
              borderRadius: "2px",
              fontSize: "12px",
              fontWeight: 700,
              fontFamily: "var(--font-geist-mono)",
              letterSpacing: "0.08em",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "creating account..." : "_CREATE_ACCOUNT"}
          </button>
        </form>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "20px 0" }}>
          <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          <span style={{ color: "var(--muted)", fontSize: "11px", fontFamily: "var(--font-geist-mono)" }}>or</span>
          <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
        </div>

        {/* Google */}
        <button
          onClick={handleGoogle}
          style={{
            width: "100%",
            padding: "11px",
            background: "transparent",
            color: "var(--text)",
            border: "1px solid var(--border-2)",
            borderRadius: "2px",
            fontSize: "12px",
            fontWeight: 600,
            fontFamily: "var(--font-geist-mono)",
            letterSpacing: "0.06em",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
          }}
        >
          <GoogleIcon />
          continue with Google
        </button>

        <p style={{ textAlign: "center", marginTop: "20px", fontSize: "12px", color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}>
          already have an account?{" "}
          <Link href="/sign-in" style={{ color: "var(--accent)", textDecoration: "none" }}>
            sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "10px",
  fontFamily: "var(--font-geist-mono)",
  color: "var(--muted)",
  letterSpacing: "0.1em",
  marginBottom: "6px",
};

const eyeBtn: React.CSSProperties = {
  position: "absolute",
  right: "10px",
  top: "50%",
  transform: "translateY(-50%)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--muted)",
  padding: "2px",
  display: "flex",
  alignItems: "center",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border-2)",
  borderRadius: "2px",
  color: "var(--text)",
  fontSize: "13px",
  fontFamily: "var(--font-geist-mono)",
  outline: "none",
  boxSizing: "border-box",
};

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
