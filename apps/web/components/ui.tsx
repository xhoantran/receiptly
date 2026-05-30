import type { ReactNode } from "react";
import { MerchantLogo } from "@/components/MerchantLogo";
import { merchantByKey } from "@/lib/merchants";

const CHIP_BG: Record<string, string> = {
  pink: "bg-pink", lilac: "bg-lilac", butter: "bg-butter", sky: "bg-sky",
  peach: "bg-peach", mint: "bg-mint", clay: "bg-clay",
};

// A transaction/merchant avatar. When the row maps to a supported merchant (it has
// a connectorKey in the catalog) we show that merchant's real logo; otherwise we
// fall back to the category emoji on a colored chip.
export function MerchantBadge({
  chip,
  emoji,
  connectorKey,
  size = 44,
}: {
  chip: string;
  emoji: string;
  connectorKey?: string | null;
  size?: number;
}) {
  const m = connectorKey ? merchantByKey[connectorKey] : undefined;
  if (m) return <MerchantLogo domain={m.domain} name={m.name} color={m.color} size={size} />;
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-2xl ${CHIP_BG[chip] ?? "bg-cream"} shadow-inset`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {emoji}
    </span>
  );
}

export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-card border border-line/80 bg-surface shadow-soft ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function Pill({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "sprout" | "muted" }) {
  const tones = {
    ink: "bg-ink-chip text-paper",
    sprout: "bg-sprout-soft text-sprout-deep",
    muted: "bg-cream text-ink-soft",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[12px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
