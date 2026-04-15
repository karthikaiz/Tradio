"use client";

import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import PortfolioPanel from "@/components/PortfolioPanel";
import PageTransition from "@/components/ui/PageTransition";

export default function PortfolioPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <Navbar />

      <PageTransition className="flex-1 w-full max-w-5xl mx-auto px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-6"
        >
          <h1 className="text-2xl font-black" style={{ color: "var(--text)" }}>Portfolio</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>Your holdings and order history</p>
        </motion.div>
        <PortfolioPanel />
      </PageTransition>
    </div>
  );
}
