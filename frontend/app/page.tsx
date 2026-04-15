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
      <section className="relative flex flex-col items-center justify-center py-24 px-4 text-center overflow-hidden">
        {/* Gradient mesh background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 80% 50% at 20% 40%, rgba(91,139,255,0.07) 0%, transparent 60%),
              radial-gradient(ellipse 60% 40% at 80% 60%, rgba(0,229,160,0.05) 0%, transparent 60%)
            `,
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 max-w-3xl mx-auto"
        >
          {/* Live badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-8"
            style={{
              background: "rgba(0,229,160,0.08)",
              border: "1px solid rgba(0,229,160,0.2)",
              color: "var(--up)",
            }}
          >
            <LiveDot />
            NSE Live Prices · Paper Trading
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-5xl sm:text-7xl font-black mb-6 leading-none tracking-tight"
            style={{ color: "var(--text)" }}
          >
            Practice Trading.
            <br />
            <span className="gradient-text hue-animate">Learn the Markets.</span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-lg sm:text-xl mb-10 leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            Get{" "}
            <span className="font-bold" style={{ color: "var(--text)" }}>
              ₹1,00,000
            </span>{" "}
            virtual money to trade real NSE stocks with live prices.
            <br className="hidden sm:block" />
            Zero risk. Real experience.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <motion.div
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Link
                href="/sign-up"
                className="inline-block px-8 py-3.5 rounded-xl font-bold text-sm shimmer-btn"
                style={{
                  background: "var(--accent)",
                  color: "#fff",
                  boxShadow: "0 0 30px var(--accent-glow), 0 4px 15px rgba(0,0,0,0.3)",
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
                className="inline-block px-8 py-3.5 rounded-xl font-semibold text-sm"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
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
        className="text-center py-16 px-4"
      >
        <h2 className="text-3xl font-black mb-3" style={{ color: "var(--text)" }}>
          Ready to practice?
        </h2>
        <p className="mb-8 text-sm" style={{ color: "var(--muted)" }}>
          Create your free account in seconds. No credit card required.
        </p>
        <motion.div
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className="inline-block"
        >
          <Link
            href="/sign-up"
            className="inline-block px-10 py-4 rounded-xl font-bold text-sm shimmer-btn"
            style={{
              background: "var(--accent)",
              color: "#fff",
              boxShadow: "0 0 30px var(--accent-glow)",
            }}
          >
            Get Started Free →
          </Link>
        </motion.div>
      </motion.section>
    </PageTransition>
  );
}
