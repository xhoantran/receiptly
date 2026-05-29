"use client";

import { useState } from "react";

const TILES = ["bg-pink", "bg-lilac", "bg-butter", "bg-sky", "bg-peach", "bg-mint", "bg-clay"];

/**
 * Product thumbnail with graceful fallback. If no image URL is known, or the
 * image fails to load (CDN miss, offline), we show a soft pastel tile with the
 * item's initial — never a broken image. Respects the "not always discoverable"
 * reality: missing data degrades quietly.
 */
export function ItemImage({
  src,
  name,
  size = 44,
}: {
  src?: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const tile = TILES[name.charCodeAt(0) % TILES.length];

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-2xl border border-line/70 bg-surface object-contain"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`grid shrink-0 place-items-center rounded-2xl ${tile} font-display font-semibold text-ink/70 shadow-inset`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {name.trim().charAt(0).toUpperCase() || "·"}
    </span>
  );
}
