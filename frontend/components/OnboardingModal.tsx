"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const STORAGE_KEY = "tradio_onboarded";

const STEPS = [
  {
    tag: "01 / 03",
    heading: "WELCOME_TO_TRADIO",
    body: "You have ₹1,00,000 in virtual cash. Practice trading real NSE stocks with zero risk — no real money involved.",
    visual: (
      <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
        <div style={{ fontSize: "2.2rem", fontWeight: 900, letterSpacing: "0.1em", color: "var(--accent)", fontFamily: "var(--font-geist-mono)" }}>
          ₹1,00,000
        </div>
        <div style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.08em", marginTop: "4px" }}>
          VIRTUAL_BALANCE · READY_TO_USE
        </div>
      </div>
    ),
    cta: "NEXT →",
  },
  {
    tag: "02 / 03",
    heading: "FIND_STOCKS_YOU_KNOW",
    body: "Search for any NSE stock by name — RELIANCE, ZOMATO, TCS, INFY. Live prices, real market data.",
    visual: (
      <div style={{ padding: "12px 0 4px" }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          background: "var(--surface-2)",
          border: "1px solid var(--accent)",
          borderRadius: "4px",
          marginBottom: "8px",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--accent)", flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "12px", color: "var(--text)" }}>Reliance Industries</span>
        </div>
        <div style={{
          padding: "8px 12px",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <div>
            <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: "11px", fontWeight: 700, color: "var(--text)" }}>Reliance Industries</div>
            <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: "10px", color: "var(--muted)" }}>RELIANCE</div>
          </div>
          <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: "11px", color: "var(--up)", fontWeight: 700 }}>+1.24%</div>
        </div>
      </div>
    ),
    cta: "NEXT →",
  },
  {
    tag: "03 / 03",
    heading: "BUY_YOUR_FIRST_STOCK",
    body: "Click any stock, enter how many shares you want, and hit BUY. Watch your portfolio update live.",
    visual: (
      <div style={{ padding: "12px 0 4px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{
            flex: 1,
            padding: "8px",
            background: "var(--up)",
            borderRadius: "2px",
            textAlign: "center",
            fontFamily: "var(--font-geist-mono)",
            fontSize: "11px",
            fontWeight: 900,
            color: "#000",
            letterSpacing: "0.06em",
          }}>
            BUY
          </div>
          <div style={{
            flex: 1,
            padding: "8px",
            border: "1px solid var(--down)",
            borderRadius: "2px",
            textAlign: "center",
            fontFamily: "var(--font-geist-mono)",
            fontSize: "11px",
            fontWeight: 700,
            color: "var(--down)",
            letterSpacing: "0.06em",
          }}>
            SELL
          </div>
        </div>
        <div style={{
          padding: "8px 12px",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: "2px",
          display: "flex",
          justifyContent: "space-between",
        }}>
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "10px", color: "var(--muted)" }}>PORTFOLIO VALUE</span>
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: "10px", color: "var(--up)", fontWeight: 700 }}>₹1,08,432 ▲</span>
        </div>
      </div>
    ),
    cta: "_START_TRADING",
  },
];

interface Props {
  show: boolean;
  onDone: () => void;
}

export default function OnboardingModal({ show, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);

  const advance = () => {
    if (step < STEPS.length - 1) {
      setDir(1);
      setStep((s) => s + 1);
    } else {
      onDone();
    }
  };

  const skip = () => onDone();

  if (!show) return null;

  const current = STEPS[step];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        style={{
          width: "100%",
          maxWidth: "340px",
          background: "var(--surface)",
          border: "1px solid var(--border-2)",
          borderRadius: "4px",
          padding: "24px",
          position: "relative",
        }}
      >
        {/* Skip */}
        <button
          onClick={skip}
          style={{
            position: "absolute",
            top: "14px",
            right: "16px",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "var(--font-geist-mono)",
            fontSize: "10px",
            color: "var(--muted)",
            letterSpacing: "0.06em",
          }}
        >
          SKIP
        </button>

        {/* Step tag */}
        <div style={{
          fontFamily: "var(--font-geist-mono)",
          fontSize: "10px",
          color: "var(--muted)",
          letterSpacing: "0.1em",
          marginBottom: "12px",
        }}>
          {current.tag}
        </div>

        {/* Heading */}
        <div style={{
          fontFamily: "var(--font-geist-mono)",
          fontSize: "15px",
          fontWeight: 900,
          color: "var(--accent)",
          letterSpacing: "0.06em",
          marginBottom: "10px",
          lineHeight: 1.2,
        }}>
          {current.heading}
        </div>

        {/* Body */}
        <p style={{
          fontFamily: "var(--font-geist-mono)",
          fontSize: "12px",
          color: "var(--text-dim)",
          lineHeight: 1.7,
          margin: 0,
        }}>
          {current.body}
        </p>

        {/* Visual */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -24 }}
            transition={{ duration: 0.18 }}
          >
            {current.visual}
          </motion.div>
        </AnimatePresence>

        {/* Progress dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: "6px", margin: "16px 0 20px" }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === step ? "20px" : "6px",
                height: "6px",
                borderRadius: "3px",
                background: i === step ? "var(--accent)" : "var(--border-2)",
                transition: "all 0.2s ease",
              }}
            />
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={advance}
          style={{
            width: "100%",
            padding: "11px",
            background: "var(--accent)",
            border: "none",
            borderRadius: "2px",
            color: "var(--accent-text)",
            fontFamily: "var(--font-geist-mono)",
            fontSize: "12px",
            fontWeight: 900,
            letterSpacing: "0.08em",
            cursor: "pointer",
          }}
        >
          {current.cta}
        </button>
      </motion.div>
    </div>
  );
}

export function useOnboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem(STORAGE_KEY)) {
      setShow(true);
    }
  }, []);

  const done = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setShow(false);
  };

  return { show, done };
}
