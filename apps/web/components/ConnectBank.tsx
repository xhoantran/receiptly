"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

// We load Plaid Link from their CDN on demand (no dependency, robust on React 19)
// rather than vendoring a wrapper. The handler is created with a fresh link token.
declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string) => void;
        onExit: (err: { display_message?: string; error_message?: string } | null) => void;
      }) => { open: () => void };
    };
  }
}

const PLAID_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

function loadPlaid(): Promise<NonNullable<Window["Plaid"]>> {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve(window.Plaid);
    const fail = () => reject(new Error("Plaid Link failed to load."));
    const done = () => (window.Plaid ? resolve(window.Plaid) : fail());
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLAID_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", done, { once: true });
      existing.addEventListener("error", fail, { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = PLAID_SRC;
    s.async = true;
    s.onload = done;
    s.onerror = fail;
    document.head.appendChild(s);
  });
}

type Status = "idle" | "starting" | "syncing" | "error";

export function ConnectBank({
  variant = "primary",
  label = "Connect a bank",
}: {
  variant?: "primary" | "ghost";
  label?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    setStatus("starting");
    try {
      const Plaid = await loadPlaid();
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = (await res.json()) as { link_token?: string; error?: string };
      if (!res.ok || !data.link_token) throw new Error(data.error ?? "Couldn't start Plaid Link.");

      const handler = Plaid.create({
        token: data.link_token,
        onSuccess: async (publicToken) => {
          setStatus("syncing");
          try {
            const ex = await fetch("/api/plaid/exchange", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ public_token: publicToken }),
            });
            const out = (await ex.json()) as { ok?: boolean; added?: number; error?: string };
            if (!ex.ok || !out.ok) throw new Error(out.error ?? "Couldn't link that account.");

            // Plaid pulls transaction history asynchronously, so the sync right
            // after linking usually returns nothing. Poll until they land (~36s).
            let added = out.added ?? 0;
            for (let i = 0; added === 0 && i < 12; i++) {
              await new Promise((r) => setTimeout(r, 3000));
              const s = await fetch("/api/plaid/sync", { method: "POST" });
              const sd = (await s.json()) as { ok?: boolean; added?: number };
              if (s.ok && sd.ok) added = sd.added ?? 0;
            }

            setStatus("idle");
            router.refresh(); // re-render the dashboard with the imported transactions
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setStatus("error");
          }
        },
        onExit: (err) => {
          if (err) setError(err.display_message ?? err.error_message ?? "Link cancelled.");
          setStatus((s) => (s === "starting" ? "idle" : s));
        },
      });
      setStatus("idle");
      handler.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [router]);

  const busy = status === "starting" || status === "syncing";
  const base =
    "inline-flex items-center gap-2 rounded-pill px-5 py-2.5 text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-sprout text-paper shadow-soft hover:bg-sprout-deep hover:shadow-pop"
      : "bg-sprout-soft text-sprout-deep hover:bg-mint";

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <button type="button" onClick={connect} disabled={busy} className={`${base} ${styles}`}>
        <span aria-hidden>{status === "syncing" ? "🔄" : "🏦"}</span>
        {status === "starting" ? "Opening…" : status === "syncing" ? "Importing transactions…" : label}
      </button>
      {error && <p className="text-[12px] font-medium text-berry">{error}</p>}
    </div>
  );
}
