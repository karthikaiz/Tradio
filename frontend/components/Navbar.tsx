"use client";

import Link from "next/link";
import { useAuth, UserButton, useClerk } from "@clerk/nextjs";
import { useTrading } from "@/lib/trading-context";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AnimatedNumber from "./ui/AnimatedNumber";
import LiveDot from "./ui/LiveDot";
import TickerTape from "./ui/TickerTape";

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);

function ThemeToggleRow() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const isDark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-medium transition-colors"
      style={{ color: "var(--text)" }}
    >
      <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
      <span
        className="w-9 h-5 rounded-full relative transition-colors flex-shrink-0"
        style={{ background: isDark ? "var(--accent)" : "var(--border-2)" }}
      >
        <motion.span
          className="absolute top-0.5 w-4 h-4 rounded-full"
          style={{ background: "#fff" }}
          animate={{ left: isDark ? "calc(100% - 18px)" : "2px" }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      </span>
    </button>
  );
}

function ThemeToggleBtn() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-8 h-8" />;
  const isDark = theme === "dark";
  return (
    <motion.button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        color: "var(--muted)",
      }}
      whileTap={{ scale: 0.9 }}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? "☀︎" : "☾"}
    </motion.button>
  );
}

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { portfolio } = useTrading();

  // Close on back navigation / escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 38 }}
            className="fixed top-0 right-0 h-full z-50 flex flex-col"
            style={{
              width: "min(300px, 82vw)",
              background: "var(--bg)",
              borderLeft: "1px solid var(--border)",
              boxShadow: "-8px 0 32px rgba(0,0,0,0.25)",
            }}
          >
            {/* Drawer header */}
            <div
              className="flex items-center justify-between px-4 py-4 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="font-black text-lg tracking-tight" style={{ color: "var(--text)" }}>
                TRADIO
              </span>
              <motion.button
                onClick={onClose}
                whileTap={{ scale: 0.9 }}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-lg"
                style={{ background: "var(--surface-2)", color: "var(--muted)" }}
              >
                ✕
              </motion.button>
            </div>

            {/* Balance chip — signed in only */}
            {isSignedIn && portfolio && (
              <div
                className="mx-4 mt-4 px-4 py-3 rounded-xl flex items-center justify-between"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border-2)" }}
              >
                <span className="text-xs" style={{ color: "var(--muted)" }}>Available Balance</span>
                <AnimatedNumber
                  value={portfolio.available_balance}
                  format={formatINR}
                  className="text-sm font-bold"
                  style={{ color: "var(--text)" }}
                />
              </div>
            )}

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto mt-2">
              {isSignedIn ? (
                <>
                  <DrawerLink href="/dashboard" icon="▦" label="Dashboard" onClick={onClose} />
                  <DrawerLink href="/portfolio" icon="◈" label="Portfolio" onClick={onClose} />
                  <Divider />
                </>
              ) : (
                <>
                  <DrawerLink href="/sign-in" icon="→" label="Sign In" onClick={onClose} />
                  <DrawerLink href="/sign-up" icon="★" label="Get Started" onClick={onClose} accent />
                  <Divider />
                </>
              )}

              {/* Theme toggle */}
              <ThemeToggleRow />
              <Divider />

              {/* Secondary links */}
              <DrawerLink href="/about" icon="ℹ" label="About" onClick={onClose} muted />
              <DrawerLink href="/privacy" icon="⚿" label="Privacy Policy" onClick={onClose} muted />

              {/* Sign out */}
              {isSignedIn && (
                <>
                  <Divider />
                  <button
                    onClick={() => { signOut(); onClose(); }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium transition-colors"
                    style={{ color: "var(--down)" }}
                  >
                    <span className="w-5 text-center text-base">↪</span>
                    Sign Out
                  </button>
                </>
              )}
            </nav>

            {/* Footer */}
            <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Paper trading · NSE live prices
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerLink({
  href, icon, label, onClick, accent, muted,
}: {
  href: string; icon: string; label: string; onClick: () => void; accent?: boolean; muted?: boolean;
}) {
  const color = accent ? "var(--accent)" : muted ? "var(--muted)" : "var(--text)";
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium transition-colors"
      style={{ color }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--border)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span className="w-5 text-center text-base" style={{ color: "var(--muted)" }}>{icon}</span>
      {label}
    </Link>
  );
}

function Divider() {
  return <div className="mx-4 my-1" style={{ height: "1px", background: "var(--border)" }} />;
}

export default function Navbar() {
  const { isSignedIn } = useAuth();
  const { portfolio } = useTrading();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <div className="sticky top-0 z-30" style={{ position: "relative" }}>
        {/* Ticker tape strip */}
        <TickerTape />

        {/* Main nav */}
        <header
          className="flex items-center justify-between px-4 sm:px-6 py-3"
          style={{
            background: "var(--overlay)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {/* Left: Logo */}
          <Link
            href={isSignedIn ? "/dashboard" : "/"}
            className="font-black text-xl tracking-tight"
            style={{ color: "var(--text)" }}
          >
            TRADIO
          </Link>

          {/* Center: live indicator — desktop only */}
          <div className="hidden sm:flex items-center gap-2">
            <LiveDot />
            <span className="text-xs font-medium tracking-wider uppercase" style={{ color: "var(--up)" }}>
              NSE Live
            </span>
          </div>

          {/* Right */}
          <div className="flex items-center gap-3">
            {/* Desktop nav */}
            <div className="hidden sm:flex items-center gap-3">
              {isSignedIn ? (
                <>
                  {portfolio && (
                    <div
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                    >
                      <span className="text-xs" style={{ color: "var(--muted)" }}>Balance</span>
                      <AnimatedNumber
                        value={portfolio.available_balance}
                        format={formatINR}
                        className="text-sm font-semibold"
                        style={{ color: "var(--text)" }}
                      />
                    </div>
                  )}
                  <motion.div whileHover={{ x: 2 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
                    <Link href="/dashboard" className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ color: "var(--muted)" }}>
                      Dashboard
                    </Link>
                  </motion.div>
                  <motion.div whileHover={{ x: 2 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
                    <Link href="/portfolio" className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ color: "var(--muted)" }}>
                      Portfolio
                    </Link>
                  </motion.div>
                  <UserButton />
                </>
              ) : (
                <>
                  <Link href="/sign-in" className="text-sm font-medium" style={{ color: "var(--muted)" }}>
                    Sign In
                  </Link>
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
                    <Link
                      href="/sign-up"
                      className="text-sm px-4 py-1.5 rounded-lg font-semibold shimmer-btn"
                      style={{ background: "var(--accent)", color: "var(--accent-text)" }}
                    >
                      Get Started →
                    </Link>
                  </motion.div>
                </>
              )}
              <ThemeToggleBtn />
            </div>

            {/* Mobile: avatar (if signed in) + hamburger */}
            <div className="flex sm:hidden items-center gap-2">
              {isSignedIn && <UserButton />}
              <motion.button
                onClick={() => setDrawerOpen(true)}
                whileTap={{ scale: 0.9 }}
                className="w-9 h-9 flex flex-col items-center justify-center gap-1.5 rounded-lg"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                aria-label="Open menu"
              >
                <span className="block w-4 h-0.5 rounded-full" style={{ background: "var(--text)" }} />
                <span className="block w-4 h-0.5 rounded-full" style={{ background: "var(--text)" }} />
                <span className="block w-3 h-0.5 rounded-full" style={{ background: "var(--text)" }} />
              </motion.button>
            </div>
          </div>
        </header>
      </div>

      {/* Mobile drawer — rendered outside sticky container so it can cover full screen */}
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
