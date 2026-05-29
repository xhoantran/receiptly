// Starts a remote interactive-login session for a merchant connector. The web
// app never touches Playwright: it asks the receipt worker (over HTTP, gated by
// WORKER_SECRET) to mint a single-use live-view session, then hands the browser
// a WS url it can open directly. The unguessable token in that url IS the gate
// (a browser WS can't send the x-worker-secret header), so we keep it server-side
// until this response.
//
// connectorsByKey is imported type/value-only for KEY VALIDATION — that module is
// pure data + (type-only) Playwright types, so it does not pull Playwright into
// the web bundle. No browser/scrape/session import lives here.
export const runtime = "nodejs";

import { connectorsByKey } from "@receiptly/core/connectors/index.js";
import { DEFAULT_USER_ID } from "@receiptly/core/lib/constants.js";

type WorkerSession = {
  sessionId: string;
  token: string;
  viewport: { width: number; height: number };
  wsPath: string;
};

const WORKER_DOWN = {
  error: "Receipt worker isn't running. Start it: pnpm --filter @receiptly/worker dev",
};

export async function POST(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;

  const connector = connectorsByKey[key];
  if (!connector) {
    return Response.json({ error: `Unknown connector: ${key}` }, { status: 404 });
  }

  const workerUrl = process.env.WORKER_URL;
  const workerWsUrl = process.env.WORKER_WS_URL;
  const secret = process.env.WORKER_SECRET;
  if (!workerUrl || !workerWsUrl || !secret) {
    return Response.json(
      { error: "Worker connection isn't configured. Set WORKER_URL, WORKER_WS_URL, WORKER_SECRET in .env." },
      { status: 500 }
    );
  }

  let res: globalThis.Response;
  try {
    res = await fetch(`${workerUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-secret": secret },
      body: JSON.stringify({ userId: DEFAULT_USER_ID, connectorKey: key }),
    });
  } catch {
    // Connection refused / DNS / network — the worker process isn't up.
    return Response.json(WORKER_DOWN, { status: 502 });
  }

  if (!res.ok) {
    let detail: string | undefined;
    try {
      detail = ((await res.json()) as { error?: string }).error;
    } catch {
      /* ignore */
    }
    return Response.json(
      { error: detail ?? "The receipt worker rejected the session request." },
      { status: 502 }
    );
  }

  const data = (await res.json()) as WorkerSession;
  return Response.json({
    wsUrl: `${workerWsUrl}${data.wsPath}?token=${data.token}`,
    viewport: data.viewport,
  });
}
