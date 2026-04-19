"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    href: "/leaderboard",
    label: "Leaderboard",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 21H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-3" />
        <path d="M12 21V9" />
        <path d="M9 9h6" />
        <path d="M12 3l2 3H10l2-3z" />
        <rect x="8" y="9" width="8" height="5" rx="1" />
      </svg>
    ),
  },
  {
    href: "/challenges",
    label: "Challenges",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2z" />
      </svg>
    ),
  },
];

export default function TerminalSidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="hidden md:flex flex-col fixed left-0 z-40"
      style={{
        top: "56px",
        bottom: "36px",
        width: "56px",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
      }}
    >
      <div className="flex flex-col items-center py-3 gap-1 flex-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className="w-10 h-10 flex items-center justify-center rounded transition-colors"
              style={{
                color: active ? "var(--accent)" : "var(--muted)",
                background: active ? "var(--accent-dim)" : "transparent",
                borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              {item.icon}
            </Link>
          );
        })}
      </div>

      <div className="pb-4 flex items-center justify-center">
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: "var(--up)" }}
          title="System Online"
        />
      </div>
    </aside>
  );
}
