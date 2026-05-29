"use client";

// Per-connector "Connect & fetch" (or "Re-sync") affordance for the Merchants
// page. The page is a server component; it passes this client wrapper the
// connector's current connection status as plain props (no Playwright, no
// browser). Clicking opens the <LiveLogin> modal, which streams a real browser
// for sign-in and then triggers the server-side scrape.

import { useState } from "react";
import { LiveLogin } from "@/components/LiveLogin";

type ConnStatus = "unlinked" | "linked" | "error";

function relativeSince(ts: number | null): string | null {
  if (!ts) return null;
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function ConnectMerchant({
  connectorKey,
  displayName,
  status,
  lastSyncAt,
  lastError,
}: {
  connectorKey: string;
  displayName: string;
  status: ConnStatus;
  lastSyncAt: number | null;
  lastError: string | null;
}) {
  const [open, setOpen] = useState(false);

  const linked = status === "linked";
  const errored = status === "error";
  const since = relativeSince(lastSyncAt);

  const label = linked ? "Re-sync" : errored ? "Try again" : "Connect & fetch";

  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <div className="min-w-0 text-[12px]">
        {linked ? (
          <span className="text-sprout-deep">
            ✓ Connected{since ? ` · synced ${since}` : ""}
          </span>
        ) : errored ? (
          <span className="truncate text-berry" title={lastError ?? undefined}>
            ⚠️ {lastError ? lastError : "Needs attention — try again"}
          </span>
        ) : (
          <span className="text-muted">Needs sign-in to fetch receipts</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill px-4 py-2 text-[13px] font-semibold transition ${
          linked
            ? "bg-sprout-soft text-sprout-deep hover:bg-mint"
            : "bg-sprout text-paper shadow-soft hover:bg-sprout-deep hover:shadow-pop"
        }`}
      >
        <span aria-hidden>{linked ? "↻" : "🔌"}</span>
        {label}
      </button>

      {open && (
        <LiveLogin
          connectorKey={connectorKey}
          displayName={displayName}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
