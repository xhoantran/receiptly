"use client";

// Per-connector "Connect & fetch" affordance for the Merchants page.
//
// In a normal browser, clicking opens the <LiveLogin> streamed-browser modal.
// Inside the receiptly desktop app (Electron), `window.receiptlyDesktop` is
// present — we instead trigger the NATIVE on-device login, which runs a real
// local Chromium that clears Akamai-class bot defenses the streamed flow can't.

import { useEffect, useState } from "react";
import { LiveLogin } from "@/components/LiveLogin";

type ConnStatus = "unlinked" | "linked" | "error";

type DesktopBridge = {
  connect: (key: string) => Promise<unknown>;
  reauth: (key: string) => Promise<unknown>;
  onStatus: (cb: (msg: string) => void) => void;
};
function getDesktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { receiptlyDesktop?: DesktopBridge }).receiptlyDesktop ?? null;
}

// Merchants the desktop app can log into on-device. Adding one here lights up its
// native "Connect & fetch" button (assuming a matching connector + capture exist).
const NATIVE_MERCHANTS = new Set(["publix", "amazon", "costco", "wholefoods"]);

function relativeSince(ts: number | null): string | null {
  if (!ts) return null;
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
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
  const [isDesktop, setIsDesktop] = useState(false);
  const [desktopMsg, setDesktopMsg] = useState<string | null>(null);

  // Detect the desktop bridge after mount (window isn't available during SSR).
  useEffect(() => {
    const d = getDesktop();
    if (!d) return;
    setIsDesktop(true);
    d.onStatus((m) => setDesktopMsg(m));
  }, []);

  const linked = status === "linked";
  const errored = status === "error";
  const since = relativeSince(lastSyncAt);
  // In the desktop app, supported merchants log in on-device (real browser, clears
  // Akamai-class defenses); everything else falls back to the streamed web flow.
  const useNative = isDesktop && NATIVE_MERCHANTS.has(connectorKey);

  const label = linked ? "Re-sync" : errored ? "Try again" : "Connect & fetch";

  const onClick = () => {
    if (useNative) {
      setDesktopMsg(`Opening ${displayName} — finish signing in in the window that opens…`);
      getDesktop()?.connect(connectorKey);
    } else {
      setOpen(true);
    }
  };

  const onReauth = () => {
    setDesktopMsg(`Signing out of ${displayName}…`);
    getDesktop()?.reauth(connectorKey);
  };

  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1 truncate text-[12px]" title={errored ? lastError ?? undefined : undefined}>
        {desktopMsg ? (
          <span className="text-sprout-deep">{desktopMsg}</span>
        ) : linked ? (
          <span className="text-sprout-deep">✓ Connected{since ? ` · synced ${since}` : ""}</span>
        ) : errored ? (
          <span className="text-berry">⚠️ {lastError ? lastError : "Needs attention — try again"}</span>
        ) : (
          <span className="text-muted">Needs sign-in to fetch receipts</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {useNative && (
          <button
            type="button"
            onClick={onReauth}
            className="text-[12px] text-muted underline underline-offset-2 hover:text-ink"
          >
            Switch account
          </button>
        )}
        <button
          type="button"
          onClick={onClick}
          className={`inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-[13px] font-semibold transition ${
            linked
              ? "bg-sprout-soft text-sprout-deep hover:bg-mint"
              : "bg-sprout text-paper shadow-soft hover:bg-sprout-deep hover:shadow-pop"
          }`}
        >
          <span aria-hidden>{linked ? "↻" : "🔌"}</span>
          {label}
        </button>
      </div>

      {open && (
        <LiveLogin connectorKey={connectorKey} displayName={displayName} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
