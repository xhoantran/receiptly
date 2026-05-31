"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview", icon: "🏡" },
  { href: "/calendar", label: "Calendar", icon: "📅" },
  { href: "/transactions", label: "Transactions", icon: "🧾" },
  { href: "/items", label: "Things I buy", icon: "🥑" },
  { href: "/connectors", label: "Merchants", icon: "🔌" },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col gap-2 border-r border-line/70 bg-cream/40 px-5 py-8 md:flex">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
        <svg viewBox="0 0 512 512" className="h-10 w-10 shrink-0 rounded-2xl shadow-soft" aria-hidden>
          <defs>
            <linearGradient id="rcptMark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#15bd79" />
              <stop offset="1" stopColor="#0a7d4d" />
            </linearGradient>
          </defs>
          <rect x="16" y="16" width="480" height="480" rx="124" fill="url(#rcptMark)" />
          <path d="M181,174 Q181,150 205,150 H307 Q331,150 331,174 V345 L306,363 281,345 256,363 231,345 206,363 181,345 Z" fill="#faf6ee" />
          <g stroke="#9bd9be" strokeWidth="13" strokeLinecap="round">
            <line x1="205" y1="208" x2="307" y2="208" />
            <line x1="205" y1="246" x2="281" y2="246" />
          </g>
          <path d="M256,150 V120" stroke="#faf6ee" strokeWidth="11" strokeLinecap="round" />
          <path d="M256,134 C235,135 221,118 231,99 C252,104 258,119 256,134 Z" fill="#faf6ee" />
          <path d="M256,134 C277,135 291,118 281,99 C260,104 254,119 256,134 Z" fill="#faf6ee" />
        </svg>
        <span className="font-display text-2xl font-semibold tracking-tight text-ink">
          receiptly
        </span>
      </Link>

      <nav className="flex flex-col gap-1.5">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`group flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[15px] font-medium transition-all ${
                active
                  ? "bg-surface text-ink shadow-soft"
                  : "text-ink-soft hover:bg-surface/60 hover:text-ink"
              }`}
            >
              <span className="text-lg transition-transform group-hover:scale-110">{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-3xl border border-line bg-surface/70 p-4">
        <p className="font-display text-[15px] font-semibold text-ink">Local & private</p>
        <p className="mt-1 text-[13px] leading-snug text-muted">
          Your receipts live on this machine only. Nothing leaves unless you ask.
        </p>
      </div>
    </aside>
  );
}
