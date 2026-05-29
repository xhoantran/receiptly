// Per-connector status for the live-login UI to poll while a scrape runs.
// DB-ONLY: reads through @receiptly/core/db/repo.js — no worker call, no
// Playwright. The LiveLogin modal hits this every ~2.5s after "scraping" until
// lastSyncAt is recent (fresh receipts landed) or status flips to "error".
export const runtime = "nodejs";

import { listConnectors, coverageStats } from "@receiptly/core/db/repo.js";
import { connectorsByKey } from "@receiptly/core/connectors/index.js";
import { DEFAULT_USER_ID } from "@receiptly/core/lib/constants.js";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!connectorsByKey[key]) {
    return Response.json({ error: `Unknown connector: ${key}` }, { status: 404 });
  }

  const [connectors, coverage] = await Promise.all([
    listConnectors(DEFAULT_USER_ID),
    coverageStats(DEFAULT_USER_ID),
  ]);

  const row = connectors.find((c) => c.key === key);
  const cov = coverage.find((c) => c.connectorKey === key);

  return Response.json({
    status: row?.status ?? "unlinked",
    lastSyncAt: row?.lastSyncAt ?? null,
    lastError: row?.lastError ?? null,
    transactions: cov?.transactions ?? 0,
    matched: cov?.matched ?? 0,
  });
}
