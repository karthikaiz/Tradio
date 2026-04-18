"use client";

import Navbar from "./Navbar";
import TerminalSidebar from "./TerminalSidebar";
import StatusBar from "./StatusBar";
import BottomTabBar from "./BottomTabBar";

interface Props {
  children: React.ReactNode;
}

export default function TerminalShell({ children }: Props) {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <Navbar />
      <TerminalSidebar />
      <StatusBar />
      <BottomTabBar />
      {/* Content: offset for fixed chrome */}
      <div className="pt-14 md:pl-14 pb-14 md:pb-9">
        {children}
      </div>
    </div>
  );
}
