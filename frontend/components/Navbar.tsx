"use client";

import Link from "next/link";
import { useAuth, UserButton } from "@clerk/nextjs";
import { useTrading } from "@/lib/trading-context";
import { motion } from "framer-motion";
import AnimatedNumber from "./ui/AnimatedNumber";
import LiveDot from "./ui/LiveDot";
import TickerTape from "./ui/TickerTape";

const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);

export default function Navbar() {
  const { isSignedIn } = useAuth();
  const { portfolio } = useTrading();

  return (
    <div className="sticky top-0 z-30" style={{ position: "relative" }}>
      {/* Ticker tape strip */}
      <TickerTape />

      {/* Main nav */}
      <header
        className="flex items-center justify-between px-4 sm:px-6 py-3"
        style={{
          background: "rgba(7, 11, 20, 0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* Left: Logo */}
        <Link
          href={isSignedIn ? "/dashboard" : "/"}
          className="font-black text-xl tracking-tighter gradient-text hue-animate"
        >
          TRADIO
        </Link>

        {/* Center: live indicator */}
        <div className="hidden sm:flex items-center gap-2">
          <LiveDot />
          <span className="text-xs font-medium tracking-wider uppercase" style={{ color: "var(--up)" }}>
            NSE Live
          </span>
        </div>

        {/* Right: auth state */}
        <div className="flex items-center gap-3">
          {isSignedIn ? (
            <>
              {portfolio && (
                <div
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
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
                <Link
                  href="/dashboard"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                  style={{ color: "var(--muted)" }}
                >
                  Dashboard
                </Link>
              </motion.div>
              <motion.div whileHover={{ x: 2 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
                <Link
                  href="/portfolio"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                  style={{ color: "var(--muted)" }}
                >
                  Portfolio
                </Link>
              </motion.div>
              <UserButton />
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="text-sm font-medium transition-colors"
                style={{ color: "var(--muted)" }}
              >
                Sign In
              </Link>
              <motion.div
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <Link
                  href="/sign-up"
                  className="text-sm px-4 py-1.5 rounded-lg font-semibold shimmer-btn"
                  style={{
                    background: "var(--accent)",
                    color: "#fff",
                    boxShadow: "0 0 20px var(--accent-glow)",
                  }}
                >
                  Get Started →
                </Link>
              </motion.div>
            </>
          )}
        </div>
      </header>
    </div>
  );
}
