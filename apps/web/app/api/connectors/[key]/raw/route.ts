// Ingest RAW merchant data captured ON-DEVICE (native desktop/mobile browser).
//
// The native app logs the user into the merchant in a real on-device browser
// (real device + residential IP → passes Akamai-class bot defenses), captures the
// receipts, and POSTs them here. Two shapes, by merchant:
//
//   • publix  — has a JSON receipt API. We get the raw API payloads and normalize
//     them with the SAME connector functions the server-side scraper uses.
//   • amazon / costco — no clean JSON API. We get each receipt's rendered TEXT and
//     LLM-extract the line items here (extractReceiptDetailFromHtml). Extraction is
//     a Claude call per receipt, so it runs in the BACKGROUND and the receipts
//     appear on the dashboard as they land.
//
// Then the normal ingest pipeline runs: match to transactions → resolve products.
// No Playwright in the web bundle: publix.ts only type-imports it.
import { rematchConnector } from "@receiptly/core/lib/ingest.js";
import { saveReceipts, markConnectorSynced } from "@receiptly/core/db/repo.js";
import { resolveProducts } from "@receiptly/core/lib/products.js";
import { extractReceiptDetailFromHtml } from "@receiptly/core/lib/extract.js";
import {
  normalizePublixOnline,
  normalizePublixDetail,
  type PublixListItem,
  type PublixDetail,
} from "@receiptly/core/connectors/publix.js";
import type { ExtractedReceipt, ReceiptItem } from "@receiptly/core/lib/extract.js";
import { DEFAULT_USER_ID } from "@receiptly/core/lib/constants.js";

export const runtime = "nodejs";

type HtmlProduct = { image?: string | null; title?: string | null };
type PublixRaw = { list?: PublixListItem[]; details?: PublixDetail[] };
type HtmlOrder = { id?: string; date?: string | null; total?: number | null; text: string; products?: HtmlProduct[] };
type HtmlRaw = { orders?: HtmlOrder[] };

// Match scraped product thumbnails (image + title) to the invoice's line items by
// title-token overlap, so the receipt shows real photos. The invoice text has no
// images; the order page has them but not the precise prices — this bridges them.
function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}
function attachImages(items: ReceiptItem[], products: HtmlProduct[]): ReceiptItem[] {
  const prods = products
    .filter((p) => p.image && p.title)
    .map((p) => ({ image: p.image as string, toks: new Set(tokenize(p.title as string)) }));
  if (!prods.length) return items;
  return items.map((it) => {
    if (it.image_url) return it;
    const want = tokenize(it.name);
    if (!want.length) return it;
    let best: { score: number; image: string } | null = null;
    for (const p of prods) {
      let n = 0;
      for (const w of want) if (p.toks.has(w)) n++;
      const score = n / want.length;
      if (score >= 0.4 && (!best || score > best.score)) best = { score, image: p.image };
    }
    return best ? { ...it, image_url: best.image } : it;
  });
}

// Merchants whose receipts arrive as rendered text (no JSON API) → LLM-extracted.
const HTML_MERCHANTS: Record<string, { store: string }> = {
  amazon: { store: "Amazon" },
  costco: { store: "Costco" },
  wholefoods: { store: "Whole Foods Market" },
};

export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;

  if (key === "publix") return ingestPublix(req);
  if (HTML_MERCHANTS[key]) return ingestHtml(req, key);
  return Response.json({ error: `On-device ingest not implemented for "${key}" yet.` }, { status: 400 });
}

// ── Publix: raw JSON API payloads → normalize (no LLM) ──
async function ingestPublix(req: Request) {
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
    await saveReceipts(DEFAULT_USER_ID, "publix", receipts);
    const { exact, total } = await rematchConnector(DEFAULT_USER_ID, "publix");
    await markConnectorSynced(DEFAULT_USER_ID, "publix");
    // Resolve items into canonical products in the BACKGROUND — it calls Claude
    // per new item and is slow on a big first import; don't block the response.
    void resolveProducts(DEFAULT_USER_ID).catch((e) => console.error("[raw] resolveProducts:", e));
    return Response.json({ ok: true, receipts: receipts.length, matched: exact, total });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// ── Amazon / Costco: rendered receipt text → LLM-extract line items ──
async function ingestHtml(req: Request, key: string) {
  let body: HtmlRaw;
  try {
    body = (await req.json()) as HtmlRaw;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const orders = (body.orders ?? []).filter((o) => o && typeof o.text === "string" && o.text.length > 0);
  if (orders.length === 0) {
    return Response.json({ ok: true, received: 0, note: "No receipts in payload." });
  }

  const { store } = HTML_MERCHANTS[key];

  // Extract + ingest in the BACKGROUND: each receipt is a Claude call, so blocking
  // the native app on N of them risks a timeout. Receipts land on the dashboard as
  // they're extracted; we return immediately with the received count.
  void (async () => {
    const receipts: ExtractedReceipt[] = [];
    for (const o of orders) {
      try {
        const ex = await extractReceiptDetailFromHtml(o.text);
        receipts.push({
          ...ex,
          items: attachImages(ex.items, o.products ?? []),
          receipt_id: o.id ?? ex.receipt_id ?? null,
          date: o.date || ex.date,
          total: o.total ?? ex.total,
          store: ex.store ?? store,
        });
      } catch (e) {
        console.error(`[raw] ${key} extract ${o.id}:`, e instanceof Error ? e.message : e);
      }
    }
    if (receipts.length === 0) {
      console.error(`[raw] ${key}: extracted 0/${orders.length} receipts`);
      return;
    }
    try {
      await saveReceipts(DEFAULT_USER_ID, key, receipts);
      await rematchConnector(DEFAULT_USER_ID, key);
      await markConnectorSynced(DEFAULT_USER_ID, key);
      void resolveProducts(DEFAULT_USER_ID).catch((e) => console.error("[raw] resolveProducts:", e));
      console.log(`[raw] ${key}: ingested ${receipts.length}/${orders.length} receipts`);
    } catch (e) {
      console.error(`[raw] ${key} ingest:`, e instanceof Error ? e.message : e);
    }
  })().catch((e) => console.error(`[raw] ${key} bg:`, e));

  return Response.json({ ok: true, received: orders.length });
}
