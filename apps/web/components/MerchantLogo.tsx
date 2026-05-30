"use client";

// Renders a merchant's real logo from its domain, falling through Clearbit →
// favicon → a branded monogram chip if a source 404s. No assets to manage: a new
// catalog entry gets a logo for free.
import { useState } from "react";
import { logoSources } from "@/lib/merchants";

export function MerchantLogo({
  domain,
  name,
  color,
  size = 44,
  rounded = "rounded-2xl",
}: {
  domain?: string;
  name: string;
  color?: string;
  size?: number;
  rounded?: string;
}) {
  const sources = domain ? logoSources(domain) : [];
  const [idx, setIdx] = useState(0);

  if (idx < sources.length) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sources[idx]}
        alt={name}
        onError={() => setIdx((i) => i + 1)}
        className={`${rounded} shrink-0 bg-white object-contain p-1 shadow-inset`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`${rounded} grid shrink-0 place-items-center font-bold text-white shadow-inset`}
      style={{ width: size, height: size, background: color ?? "#918b7e", fontSize: size * 0.4 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
