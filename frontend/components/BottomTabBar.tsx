"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const TABS = [
  {
    href: "/dashboard",
    label: "WATCHLIST",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/portfolio",
    label: "PORTFOLIO",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
];

export default function BottomTabBar() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();

  if (!isSignedIn) return null;

  return (
    <nav
      className="flex md:hidden fixed bottom-0 left-0 right-0 z-40"
      style={{
        height: "56px",
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
      }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative"
            style={{
              color: active ? "var(--accent)" : "var(--muted)",
              borderTop: `2px solid ${active ? "var(--accent)" : "transparent"}`,
            }}
          >
            {tab.icon}
            <span
              style={{
                fontSize: "9px",
                fontFamily: "var(--font-geist-mono)",
                letterSpacing: "0.08em",
              }}
            >
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
