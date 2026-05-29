// Ingest RAW merchant API payloads captured ON-DEVICE (native app WebView).
//
// The native app logs the user into the merchant in a real on-device WebView
// (real device + residential IP + touch → passes Akamai), captures the raw
// receipt API responses, and POSTs them here. We normalize with the SAME
// connector functions the server-side scraper uses, then run the normal ingest
// pipeline (match to transactions → resolve products). No Playwright in the web
// bundle: publix.ts only type-imports it.
import { ingest } from "@receiptly/core/lib/ingest.js";
import {
  normalizePublixOnline,
  normalizePublixDetail,
  type PublixListItem,
  type PublixDetail,
} from "@receiptly/core/connectors/publix.js";
import type { ExtractedReceipt } from "@receiptly/core/lib/extract.js";
import { DEFAULT_USER_ID } from "@receiptly/core/lib/constants.js";

export const runtime = "nodejs";

type PublixRaw = { list?: PublixListItem[]; details?: PublixDetail[] };

export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (key !== "publix") {
    return Response.json({ error: `On-device ingest not implemented for "${key}" yet.` }, { status: 400 });
  }

  let body: PublixRaw;
  try {
    body = (await req.json()) as PublixRaw;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Online orders carry their line items in the list; in-store receipts need the
  // per-receipt detail payload.
  const receipts: ExtractedReceipt[] = [];
  for (const l of body.list ?? []) {
    if (l.IsOnlineOrder) receipts.push(normalizePublixOnline(l));
  }
  for (const d of body.details ?? []) {
    receipts.push(normalizePublixDetail(d));
  }

  if (receipts.length === 0) {
    return Response.json({ ok: true, receipts: 0, note: "No receipts in payload." });
  }

  try {
    const r = await ingest(DEFAULT_USER_ID, "publix", receipts);
    return Response.json({ ok: true, ...r });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
