"use client";

// LiveLogin streams a real (server-side, headless WebKit) browser into the page
// so a non-technical user can sign in to a merchant without a terminal. The
// worker pushes JPEG screenshots over a WebSocket; we paint them onto a <canvas>
// and forward mouse/keyboard back as the SHARED WIRE CONTRACT JSON messages.
//
// No Playwright/browser import here — the browser lives in the worker. We only
// open a WS to the url the /login route minted and POST/GET our own Next routes.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

type Viewport = { width: number; height: number };
type LoginResp = { wsUrl: string; viewport: Viewport } | { error: string };
type WsState = "loading" | "awaiting_login" | "logged_in" | "scraping" | "error";

type Phase =
  | { kind: "starting" }
  | { kind: "worker_down"; message: string }
  | { kind: "error"; message: string }
  | { kind: "live"; state: WsState; message?: string };

const STATUS_COPY: Record<WsState, string> = {
  loading: "Loading the merchant's sign-in page…",
  awaiting_login: "Sign in below — type your username & password right in the window.",
  logged_in: "Signed in — fetching your receipts…",
  scraping: "Signed in — fetching your receipts…",
  error: "Something went wrong.",
};

export function LiveLogin({
  connectorKey,
  displayName,
  onClose,
}: {
  connectorKey: string;
  displayName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baselineSyncRef = useRef<number | null>(null);
  const closedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [viewport, setViewport] = useState<Viewport>({ width: 1280, height: 800 });
  // Set when the worker uses a remote provider (Browserbase): we embed its
  // interactive live-view iframe instead of streaming our own canvas.
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  // Bumped to re-run the connect effect on "Retry".
  const [attempt, setAttempt] = useState(0);
  // Render the modal at <body> via a portal so it escapes the connector card's
  // stacking context (the `.rise`/transform ancestors otherwise trap fixed+z-50,
  // letting sibling cards paint over it).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Single graceful teardown: stop polling, send {type:"close"}, close socket.
  const teardown = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "close" }));
      } catch {
        /* ignore */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    teardown();
    onClose();
  }, [teardown, onClose]);

  // Poll our DB-only status route until a fresh sync lands (or status errors),
  // then close the modal and refresh the server components (page picks up the
  // new receipts + coverage).
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/connectors/${connectorKey}/status`, { cache: "no-store" });
        const d = (await r.json()) as {
          status?: string;
          lastSyncAt?: number | null;
          lastError?: string | null;
        };
        if (d.status === "error") {
          setPhase({ kind: "live", state: "error", message: d.lastError ?? "Scrape failed." });
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          return;
        }
        const synced = d.lastSyncAt ?? null;
        const baseline = baselineSyncRef.current;
        // A sync is "fresh" if it advanced past the value we saw before login.
        if (synced != null && (baseline == null || synced > baseline)) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          router.refresh();
          close();
        }
      } catch {
        /* transient — keep polling */
      }
    }, 2500);
  }, [connectorKey, router, close]);

  // ── Connect: POST /login → open WS → stream frames + forward input ──
  useEffect(() => {
    closedRef.current = false;
    let cancelled = false;
    let frameUrl: string | null = null; // object URL of the in-flight frame
    setPhase({ kind: "starting" });
    setLiveViewUrl(null);

    (async () => {
      // Capture the pre-login sync time so polling can detect a NEW scrape.
      try {
        const s = await fetch(`/api/connectors/${connectorKey}/status`, { cache: "no-store" });
        const sd = (await s.json()) as { lastSyncAt?: number | null };
        baselineSyncRef.current = sd.lastSyncAt ?? null;
      } catch {
        baselineSyncRef.current = null;
      }

      let resp: LoginResp;
      let httpStatus = 0;
      try {
        const r = await fetch(`/api/connectors/${connectorKey}/login`, { method: "POST" });
        httpStatus = r.status;
        resp = (await r.json()) as LoginResp;
      } catch {
        if (!cancelled)
          setPhase({
            kind: "worker_down",
            message: "Receipt worker isn't running. Start it: pnpm --filter @receiptly/worker dev",
          });
        return;
      }
      if (cancelled) return;

      if ("error" in resp || !("wsUrl" in resp)) {
        const message = "error" in resp ? resp.error : "Couldn't start the sign-in session.";
        setPhase(httpStatus === 502 ? { kind: "worker_down", message } : { kind: "error", message });
        return;
      }

      setViewport(resp.viewport);
      setPhase({ kind: "live", state: "loading" });

      const ws = new WebSocket(resp.wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          let msg: { type?: string; viewport?: Viewport; state?: WsState; message?: string; url?: string };
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (msg.type === "meta" && msg.viewport) {
            setViewport(msg.viewport);
          } else if (msg.type === "liveview" && msg.url) {
            setLiveViewUrl(msg.url);
          } else if (msg.type === "status" && msg.state) {
            setPhase({ kind: "live", state: msg.state, message: msg.message });
            if (msg.state === "scraping") startPolling();
            if (msg.state === "error") {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
            }
          }
          return;
        }
        // Binary = JPEG frame. Paint it onto the canvas.
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const blob = new Blob([ev.data as ArrayBuffer], { type: "image/jpeg" });
        if ("createImageBitmap" in window) {
          createImageBitmap(blob)
            .then((bitmap) => {
              if (!canvasRef.current) return;
              ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
              bitmap.close();
            })
            .catch(() => {
              /* drop frame */
            });
        } else {
          // Fallback for engines without createImageBitmap.
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
          };
          img.onerror = () => URL.revokeObjectURL(url);
          if (frameUrl) URL.revokeObjectURL(frameUrl);
          frameUrl = url;
          img.src = url;
        }
      };

      ws.onerror = () => {
        if (cancelled || closedRef.current) return;
        setPhase((p) =>
          p.kind === "live" && (p.state === "scraping" || p.state === "logged_in")
            ? p // a clean close after login isn't an error
            : { kind: "error", message: "Lost connection to the sign-in window." }
        );
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      if (frameUrl) URL.revokeObjectURL(frameUrl);
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectorKey, attempt]);

  // ── Input forwarding: client coords → viewport coords ──
  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const toViewport = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: Math.round((clientX - rect.left) * scaleX),
        y: Math.round((clientY - rect.top) * scaleY),
      };
    },
    []
  );

  const interactive = phase.kind === "live" && (phase.state === "loading" || phase.state === "awaiting_login");
  // Phone-ratio viewports render a tall, narrow canvas; size by height and use a
  // slim modal. Desktop (landscape) fills the wide modal as before.
  const portrait = viewport.height >= viewport.width;

  const onMouse = useCallback(
    (action: "move" | "down" | "up" | "click") => (e: React.MouseEvent) => {
      if (!interactive) return;
      const { x, y } = toViewport(e.clientX, e.clientY);
      const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
      send({ type: "mouse", action, x, y, button });
    },
    [interactive, toViewport, send]
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!interactive) return;
      send({ type: "wheel", dx: e.deltaX, dy: e.deltaY });
    },
    [interactive, send]
  );

  // Keyboard: forward control keys as {type:"key"} and printable text as
  // {type:"text"} so passwords land character-by-character. The canvas is
  // focusable (tabIndex) so it owns keystrokes once clicked.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!interactive) return;
      const k = e.key;
      if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        send({ type: "text", text: k });
        return;
      }
      // Named keys Playwright understands directly.
      const named = new Set([
        "Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowUp", "ArrowDown",
        "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space",
      ]);
      const key = k === " " ? "Space" : k;
      if (named.has(key)) {
        e.preventDefault();
        send({ type: "key", action: "press", key });
      }
    },
    [interactive, send]
  );

  // Focus the canvas as soon as it's ready so keystrokes are captured.
  useEffect(() => {
    if (interactive) canvasRef.current?.focus();
  }, [interactive]);

  const retry = () => {
    closedRef.current = false;
    setAttempt((a) => a + 1);
  };

  const banner = (() => {
    switch (phase.kind) {
      case "starting":
        return { tone: "neutral" as const, text: `Opening ${displayName}…` };
      case "worker_down":
        return { tone: "error" as const, text: phase.message };
      case "error":
        return { tone: "error" as const, text: phase.message };
      case "live":
        return {
          tone: phase.state === "error" ? ("error" as const) : ("neutral" as const),
          text: phase.message ?? STATUS_COPY[phase.state],
        };
    }
  })();

  const showCanvas = phase.kind === "live";
  const showRetry = phase.kind === "worker_down" || phase.kind === "error";

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Sign in to ${displayName}`}
      onMouseDown={(e) => {
        // Click on the dim backdrop closes (but not on the card itself).
        if (e.target === e.currentTarget) close();
      }}
    >
      <Card className={`flex max-h-[92vh] w-full flex-col overflow-hidden p-0 ${portrait ? "max-w-sm" : "max-w-5xl"}`}>
        <header className="flex items-center justify-between gap-3 border-b border-line/80 px-5 py-3.5">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold text-ink">Connect {displayName}</p>
            <p className="truncate text-[12px] text-muted">
              A real browser, streamed live. Your credentials go straight to the merchant.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-pill bg-cream px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition hover:bg-line"
          >
            Close
          </button>
        </header>

        <div
          className={`flex items-center gap-2 px-5 py-2.5 text-[13px] font-medium ${
            banner.tone === "error" ? "bg-berry/10 text-berry" : "bg-sprout-soft/50 text-sprout-deep"
          }`}
        >
          <span aria-hidden>
            {banner.tone === "error"
              ? "⚠️"
              : phase.kind === "live" && (phase.state === "scraping" || phase.state === "logged_in")
                ? "🌱"
                : "🔒"}
          </span>
          <span className="min-w-0 flex-1">{banner.text}</span>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-cream/40 p-4">
          {liveViewUrl ? (
            <iframe
              src={liveViewUrl}
              title={`Sign in to ${displayName}`}
              allow="clipboard-read; clipboard-write"
              className="h-[78vh] w-full rounded-xl border border-line bg-white shadow-soft"
            />
          ) : showCanvas ? (
            <canvas
              ref={canvasRef}
              width={viewport.width}
              height={viewport.height}
              tabIndex={0}
              onMouseMove={onMouse("move")}
              onMouseDown={onMouse("down")}
              onMouseUp={onMouse("up")}
              onClick={onMouse("click")}
              onWheel={onWheel}
              onKeyDown={onKeyDown}
              onContextMenu={(e) => e.preventDefault()}
              className={`rounded-xl border border-line bg-white shadow-soft outline-none ring-sprout/40 focus:ring-2 ${portrait ? "h-[76vh] w-auto max-w-full" : "w-full max-h-[76vh]"}`}
              style={{ aspectRatio: `${viewport.width} / ${viewport.height}`, touchAction: "none", cursor: interactive ? "crosshair" : "default" }}
            />
          ) : (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              {showRetry ? (
                <>
                  <p className="max-w-md text-[14px] leading-snug text-muted">{banner.text}</p>
                  <button
                    type="button"
                    onClick={retry}
                    className="inline-flex items-center gap-2 rounded-pill bg-sprout px-5 py-2.5 text-[14px] font-semibold text-paper shadow-soft transition hover:bg-sprout-deep"
                  >
                    <span aria-hidden>↻</span> Try again
                  </button>
                </>
              ) : (
                <p className="text-[14px] text-muted">Opening {displayName}…</p>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );

  return mounted ? createPortal(modal, document.body) : null;
}
