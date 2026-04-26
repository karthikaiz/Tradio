"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

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
];

const AUTH_REQUIRED = new Set(["/dashboard", "/portfolio"]);

export default function TerminalSidebar() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  const visibleItems = isSignedIn ? NAV_ITEMS : NAV_ITEMS.filter((item) => !AUTH_REQUIRED.has(item.href));

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
        {visibleItems.map((item) => {
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
