/**
 * @receiptly/worker — the standalone Node process behind Phase 2's server-side
 * scraping + remote interactive login. It runs TWO things in one process:
 *
 *   1. A pg-boss "scrape" queue. After a successful interactive login the worker
 *      (or a future scheduler) enqueues {userId, connectorKey}; the handler runs
 *      core runScrape() headlessly (WebKit) and updates merchant_connections.
 *
 *   2. An HTTP + WebSocket server (the LIVE-VIEW). The web app's API route asks
 *      the worker (server->server, x-worker-secret) to create a pending login
 *      session; the browser then connects the WS and we stream JPEG screenshots
 *      of a real WebKit page while relaying the user's mouse/keyboard back. When
 *      connector.isLoggedIn(page) flips true we capture+encrypt the session and
 *      enqueue a scrape.
 *
 * Playwright lives here (and in packages/core's browser modules) — never in
 * apps/web. The web app reaches all of this over HTTP/WS only.
 *
 * WebKit ONLY (via core's LocalBrowserProvider): it carries no automation flags
 * and passes merchant bot defenses where Chromium is blocked. Headless is fine
 * because the live-view streams screenshots rather than showing a window.
 */
import "@receiptly/core/lib/load-env.js";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import PgBoss from "pg-boss";

import {
  browserProvider,
  DEFAULT_VIEWPORT,
  type Viewport,
} from "@receiptly/core/lib/browser/provider.js";
import { runScrape } from "@receiptly/core/lib/scrape.js";
import { connectorsByKey } from "@receiptly/core/connectors/index.js";
import {
  getMerchantSession,
  saveMerchantSession,
  setMerchantConnectionStatus,
} from "@receiptly/core/db/repo.js";

// ─── Config (see SHARED WIRE CONTRACT) ───
const PORT = Number(process.env.WORKER_PORT ?? 4100);
const WORKER_SECRET = process.env.WORKER_SECRET ?? "";
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const VIEWPORT: Viewport = DEFAULT_VIEWPORT; // fixed 1280x800 for login sessions

const SESSION_TTL_MS = 5 * 60_000; // 5-minute pending-session + login-window TTL
const SCREENSHOT_INTERVAL_MS = 200; // ~5 fps JPEG stream
const LOGIN_POLL_MS = 1500; // connector.isLoggedIn poll cadence

if (!WORKER_SECRET) {
  console.error("[worker] FATAL: WORKER_SECRET is not set (see .env)");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("[worker] FATAL: DATABASE_URL is not set (see .env)");
  process.exit(1);
}

// ─── Pending login sessions (in-memory; single WS use, 5-min TTL) ───
type PendingSession = {
  sessionId: string;
  token: string;
  userId: string;
  connectorKey: string;
  createdAt: number; // epoch ms
  used: boolean;
};

const sessions = new Map<string, PendingSession>();

function sweepSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
}
setInterval(sweepSessions, 60_000).unref();

// ─── HTTP helpers ───
function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(json);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function authed(req: IncomingMessage): boolean {
  return req.headers["x-worker-secret"] === WORKER_SECRET;
}

// pg-boss is created in main() and referenced by the WS login flow.
let boss: PgBoss;

// ─── HTTP server ───
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // /health and every other route require the shared secret.
  if (!authed(req)) {
    send(res, 401, { error: "unauthorized" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/sessions") {
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") {
      send(res, 400, { error: "invalid JSON body" });
      return;
    }
    const { userId, connectorKey } = body as { userId?: string; connectorKey?: string };
    if (!userId || !connectorKey) {
      send(res, 400, { error: "userId and connectorKey are required" });
      return;
    }
    if (!connectorsByKey[connectorKey]) {
      send(res, 400, { error: `Unknown connector: ${connectorKey}` });
      return;
    }

    const sessionId = randomUUID();
    const token = randomUUID();
    sessions.set(sessionId, {
      sessionId,
      token,
      userId,
      connectorKey,
      createdAt: Date.now(),
      used: false,
    });

    send(res, 200, {
      sessionId,
      token,
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      wsPath: `/live/${sessionId}`,
    });
    return;
  }

  send(res, 404, { error: "not found" });
});

// ─── WebSocket live-view ───
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const match = url.pathname.match(/^\/live\/([^/]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const sessionId = match[1];
  const token = url.searchParams.get("token") ?? "";

  const session = sessions.get(sessionId);
  const fresh = session && Date.now() - session.createdAt <= SESSION_TTL_MS;
  if (!session || !fresh || session.used || session.token !== token) {
    // Note: WS upgrade has no useful header auth from a browser; the single-use,
    // unguessable token (minted via the secret-gated POST /sessions) is the gate.
    socket.destroy();
    return;
  }
  session.used = true; // single use

  wss.handleUpgrade(req, socket, head, (ws) => {
    runLiveView(ws, session).catch((err) => {
      console.error(`[worker] live-view fatal for ${sessionId}:`, err);
      try {
        ws.close();
      } catch {}
    });
  });
});

// ─── Client->server message shapes (see SHARED WIRE CONTRACT) ───
type ClientMessage =
  | { type: "mouse"; action: "move" | "down" | "up" | "click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "wheel"; dx: number; dy: number }
  | { type: "key"; action: "down" | "press"; key: string }
  | { type: "text"; text: string }
  | { type: "close" };

type StatusState = "loading" | "awaiting_login" | "logged_in" | "scraping" | "error";

/**
 * The remote interactive login. Launches a headless WebKit context (restoring
 * any prior encrypted session), navigates to the connector's login URL, streams
 * JPEG screenshots, relays input, and watches for login success.
 */
async function runLiveView(ws: WebSocket, session: PendingSession): Promise<void> {
  const { userId, connectorKey, sessionId } = session;
  const connector = connectorsByKey[connectorKey];

  const sendJson = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };
  const sendStatus = (state: StatusState, message?: string) =>
    sendJson(message ? { type: "status", state, message } : { type: "status", state });

  let closed = false;
  let screenshotTimer: ReturnType<typeof setInterval> | null = null;
  let loginTimer: ReturnType<typeof setInterval> | null = null;
  let hardTimeout: ReturnType<typeof setTimeout> | null = null;

  // Opened lazily so teardown only closes what exists.
  let ctx: Awaited<ReturnType<typeof browserProvider.openContext>> | null = null;

  const teardown = async (closeWs = true) => {
    if (closed) return;
    closed = true;
    if (screenshotTimer) clearInterval(screenshotTimer);
    if (loginTimer) clearInterval(loginTimer);
    if (hardTimeout) clearTimeout(hardTimeout);
    screenshotTimer = loginTimer = null;
    hardTimeout = null;
    sessions.delete(sessionId);
    if (ctx) {
      await ctx.browser.close().catch(() => {});
      ctx = null;
    }
    if (closeWs) {
      try {
        ws.close();
      } catch {}
    }
  };

  // Socket lifecycle: any close/error tears everything down.
  ws.on("close", () => void teardown(false));
  ws.on("error", () => void teardown(false));

  // Hard 5-minute cap on the whole interactive window.
  hardTimeout = setTimeout(() => {
    sendStatus("error", "Login timed out. Please try again.");
    void teardown();
  }, SESSION_TTL_MS);

  try {
    sendStatus("loading");
    const prior = await getMerchantSession(userId, connectorKey);
    ctx = await browserProvider.openContext({
      storageState: prior ?? undefined,
      viewport: VIEWPORT,
      headless: true,
    });
    const { page } = ctx;

    sendJson({ type: "meta", viewport: { width: VIEWPORT.width, height: VIEWPORT.height } });

    await page.goto(connector.loginUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    if (closed) return;
    sendStatus("awaiting_login");

    // ── Screenshot stream (~5 fps), guarded against overlap + closed page ──
    let shooting = false;
    screenshotTimer = setInterval(() => {
      if (closed || shooting || page.isClosed() || ws.readyState !== WebSocket.OPEN) return;
      shooting = true;
      page
        .screenshot({ type: "jpeg", quality: 55 })
        .then((buf) => {
          if (!closed && ws.readyState === WebSocket.OPEN) ws.send(buf);
        })
        .catch(() => {})
        .finally(() => {
          shooting = false;
        });
    }, SCREENSHOT_INTERVAL_MS);

    // ── Relay client input -> Playwright ──
    ws.on("message", (raw) => {
      if (closed || page.isClosed()) return;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }
      void handleClientMessage(msg).catch(() => {});

      async function handleClientMessage(m: ClientMessage) {
        switch (m.type) {
          case "mouse": {
            const button = m.button ?? "left";
            if (m.action === "move") await page.mouse.move(m.x, m.y);
            else if (m.action === "down") await page.mouse.down({ button });
            else if (m.action === "up") await page.mouse.up({ button });
            else if (m.action === "click") await page.mouse.click(m.x, m.y, { button });
            return;
          }
          case "wheel":
            await page.mouse.wheel(m.dx, m.dy);
            return;
          case "key":
            if (m.action === "down") await page.keyboard.down(m.key);
            else await page.keyboard.press(m.key);
            return;
          case "text":
            await page.keyboard.type(m.text);
            return;
          case "close":
            await teardown();
            return;
        }
      }
    });

    // ── Login detection: on success, persist + enqueue scrape ──
    let finishing = false;
    loginTimer = setInterval(() => {
      if (closed || finishing || page.isClosed()) return;
      void (async () => {
        const ok = await connector.isLoggedIn(page).catch(() => false);
        if (!ok || closed || finishing) return;
        finishing = true;
        if (loginTimer) clearInterval(loginTimer);
        loginTimer = null;
        if (screenshotTimer) clearInterval(screenshotTimer);
        screenshotTimer = null;

        try {
          const state = await browserProvider.captureState(ctx!.context);
          await saveMerchantSession(userId, connectorKey, state);
          await setMerchantConnectionStatus(userId, connectorKey, "linked");
          sendStatus("logged_in");

          // Close the browser before enqueuing the headless scrape.
          await ctx!.browser.close().catch(() => {});
          ctx = null;

          await boss.send("scrape", { userId, connectorKey });
          sendStatus("scraping");
        } catch (err) {
          console.error(`[worker] login-finalize error for ${sessionId}:`, err);
          sendStatus("error", err instanceof Error ? err.message : String(err));
        } finally {
          // Stop streaming + close the WS; the web UI now polls the status endpoint.
          await teardown();
        }
      })();
    }, LOGIN_POLL_MS);
  } catch (err) {
    console.error(`[worker] live-view setup error for ${sessionId}:`, err);
    sendStatus("error", err instanceof Error ? err.message : String(err));
    await teardown();
  }
}

// ─── Boot: pg-boss queue + HTTP/WS server ───
async function main() {
  boss = new PgBoss(DATABASE_URL);
  boss.on("error", (err) => console.error("[worker] pg-boss error:", err));
  await boss.start();
  await boss.createQueue("scrape");

  // Concurrency 1: the default single worker, batchSize 1 (one job at a time).
  await boss.work<{ userId: string; connectorKey: string }>("scrape", async ([job]) => {
    const { userId, connectorKey } = job.data;
    console.log(`[worker] scrape job ${job.id}: ${connectorKey} (user ${userId})`);
    try {
      const result = await runScrape(userId, connectorKey);
      console.log(
        `[worker] scrape done ${connectorKey}: ${result.receipts} receipts, ${result.matched}/${result.total} matched`
      );
    } catch (err) {
      // runScrape already recorded status "error" + lastError; rethrow so pg-boss
      // marks the job failed (visible for retry/inspection).
      console.error(`[worker] scrape failed ${connectorKey}:`, err);
      throw err;
    }
  });

  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`[worker] http+ws on :${PORT}, pg-boss scrape queue ready`);
}

main().catch((err) => {
  console.error("[worker] fatal startup error:", err);
  process.exit(1);
});
