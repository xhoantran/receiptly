"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Manual "pull new transactions" lever. Plaid delivers history in waves after
// linking, so a user may need to sync again later to catch the rest.
export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/plaid/sync", { method: "POST" });
      const d = (await r.json()) as { ok?: boolean; added?: number; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Sync failed.");
      router.refresh();
      setMsg((d.added ?? 0) > 0 ? `+${d.added} new` : "Up to date");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-pill border border-line bg-surface px-4 py-2.5 text-[14px] font-semibold text-ink-soft transition hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span aria-hidden>{busy ? "🔄" : "↻"}</span>
        {busy ? "Syncing…" : "Sync"}
      </button>
      {msg && <p className="text-[12px] font-medium text-muted">{msg}</p>}
    </div>
  );
}
