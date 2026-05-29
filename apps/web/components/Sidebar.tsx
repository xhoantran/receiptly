"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview", icon: "🏡" },
  { href: "/transactions", label: "Transactions", icon: "🧾" },
  { href: "/items", label: "Things I buy", icon: "🥑" },
  { href: "/connectors", label: "Merchants", icon: "🔌" },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col gap-2 border-r border-line/70 bg-cream/40 px-5 py-8 md:flex">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-sprout text-lg shadow-soft">
          🧾
        </span>
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
