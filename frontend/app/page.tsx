"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import MarketCategories from "@/components/MarketCategories";
import GlassCard from "@/components/ui/GlassCard";
import LiveDot from "@/components/ui/LiveDot";
import PageTransition from "@/components/ui/PageTransition";

const FEATURES = [
  {
    icon: "₹",
    title: "₹1,00,000 Virtual Balance",
    desc: "Every new account starts with one lakh rupees. No deposits, no real money at risk.",
    color: "var(--up)",
  },
  {
    icon: "⚡",
    title: "Live NSE Prices",
    desc: "Real-time NSE quotes powered by market data. Practice with prices you'd see in real trading.",
    color: "var(--accent)",
  },
  {
    icon: "📊",
    title: "Advanced Charts",
    desc: "Lightweight Charts with area & candlestick view, multiple timeframes — 1D, 5D, 1M, 3M, 1Y.",
    color: "var(--down)",
  },
];

export default function LandingPage() {
  return (
    <PageTransition className="min-h-screen flex flex-col" style={{ background: "var(--bg)" } as React.CSSProperties}>
      <Navbar />

      {/* Hero section */}
      <section className="relative flex flex-col items-center justify-center py-28 px-4 text-center overflow-hidden">
        {/* Subtle top-center glow only */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none"
          style={{
            width: "600px",
            height: "300px",
            background: "radial-gradient(ellipse at top, rgba(212,168,67,0.06) 0%, transparent 70%)",
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 max-w-2xl mx-auto"
        >
          {/* Live badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-10"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-2)",
              color: "var(--muted)",
            }}
          >
            <LiveDot />
            NSE Live · Paper Trading
          </motion.div>

          {/* Headline — single color, no gradient */}
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="text-5xl sm:text-6xl font-black mb-5 leading-tight tracking-tight"
            style={{ color: "var(--text)" }}
          >
            Trade Indian Stocks.
            <br />
            Zero Real Money.
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="text-base sm:text-lg mb-10 leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            Start with{" "}
            <span className="font-semibold" style={{ color: "var(--text)" }}>
              ₹1,00,000
            </span>{" "}
            virtual balance. Live NSE prices, real charts, real P&L — no risk.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <motion.div
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Link
                href="/sign-up"
                className="inline-block px-8 py-3 rounded-lg font-semibold text-sm shimmer-btn"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                }}
              >
                Start Trading Free →
              </Link>
            </motion.div>
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Link
                href="/sign-in"
                className="inline-block px-8 py-3 rounded-lg font-medium text-sm"
                style={{
                  border: "1px solid var(--border-2)",
                  color: "var(--muted)",
                }}
              >
                Sign In
              </Link>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* Market Pulse */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="max-w-5xl mx-auto w-full px-4 py-10"
      >
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-xl font-bold" style={{ color: "var(--text)" }}>Market Pulse</h2>
          <div className="flex items-center gap-1.5">
            <LiveDot />
            <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "var(--up)" }}>LIVE</span>
          </div>
        </div>
        <MarketCategories />
      </motion.section>

      {/* Feature grid */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="max-w-5xl mx-auto w-full px-4 py-10"
      >
        <h2 className="text-xl font-bold mb-6" style={{ color: "var(--text)" }}>Why Tradio?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <GlassCard tilt className="p-5 rounded-2xl h-full">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold mb-4"
                  style={{
                    background: `${f.color}15`,
                    border: `1px solid ${f.color}30`,
                    color: f.color,
                  }}
                >
                  {f.icon}
                </div>
                <h3 className="font-bold mb-2 text-sm" style={{ color: "var(--text)" }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{f.desc}</p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Footer CTA */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="text-center py-16 px-4 border-t"
        style={{ borderColor: "var(--border)" }}
      >
        <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--text)" }}>
          Ready to start?
        </h2>
        <p className="mb-8 text-sm" style={{ color: "var(--muted)" }}>
          Free account. No credit card. ₹1,00,000 to practice with.
        </p>
        <motion.div
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className="inline-block"
        >
          <Link
            href="/sign-up"
            className="inline-block px-8 py-3 rounded-lg font-semibold text-sm shimmer-btn"
            style={{
              background: "var(--accent)",
              color: "var(--accent-text)",
            }}
          >
            Get Started Free →
          </Link>
        </motion.div>
      </motion.section>
    </PageTransition>
  );
}
