/**
 * Product resolution: map raw receipt line items → canonical products.
 *
 * Pipeline per item:
 *   1. key = UPC if present, else a normalized name-slug
 *   2. if we've seen that key before (product_links) → reuse the product
 *   3. otherwise ask Claude (batched) for {brand, canonical_name, size, category},
 *      dedupe by signature, create the product, remember the key
 *
 * The LLM is consulted once per never-before-seen key; everything after is a
 * cache hit, so re-runs are cheap.
 */
import Anthropic from "@anthropic-ai/sdk";
import { eq, isNull } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "../db/index.js";
import { receiptItems, products, productLinks } from "../db/schema.js";
import { CATEGORY_LABELS } from "./taxonomy.js";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = "claude-sonnet-4-6";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type Classified = { brand: string | null; canonical_name: string; size: string | null; category: string };

async function classify(names: string[]): Promise<Classified[]> {
  const system = `You normalize messy retail line-item names into canonical products.
For EACH input name return an object:
- brand: the brand if identifiable, else null
- canonical_name: a clean, consistent product name (no size, no marketing fluff). Same product from different
  retailers should produce the SAME canonical_name. e.g. "OATLY OATMILK" and "Oatly Full Fat Oatmilk 64oz"
  → "Oatly Oatmilk".
- size: pack/size if present (e.g. "64 fl oz", "5 ct"), else null
- category: choose EXACTLY ONE from this list: ${CATEGORY_LABELS.join(" | ")}

Return ONLY a JSON array, one object per input, in the same order. No prose.`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: JSON.stringify(names) }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1) throw new Error(`classify: no JSON array in: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

export async function resolveProducts(opts: { force?: boolean } = {}): Promise<{ resolved: number; created: number }> {
  const items = await db
    .select()
    .from(receiptItems)
    .where(opts.force ? undefined : isNull(receiptItems.productId));
  if (items.length === 0) return { resolved: 0, created: 0 };

  const links = await db.select().from(productLinks);
  const linkMap = new Map(links.map((l) => [`${l.kind}:${l.value}`, l.productId]));

  const keyOf = (it: (typeof items)[number]) => (it.upc ? `upc:${it.upc}` : `name:${slug(it.name)}`);

  // distinct keys with no existing link → need LLM
  const needLLM = new Map<string, { name: string; image: string | null }>();
  const itemKey = new Map<number, string>();
  for (const it of items) {
    const k = keyOf(it);
    itemKey.set(it.id, k);
    if (!linkMap.has(k) && !needLLM.has(k)) needLLM.set(k, { name: it.name, image: it.imageUrl });
  }

  let created = 0;
  if (needLLM.size > 0) {
    const entries = [...needLLM.entries()];
    console.log(`[products] classifying ${entries.length} new items via Claude…`);
    const classified = await classify(entries.map(([, v]) => v.name));

    const existing = await db.select().from(products);
    const sig = (c: { brand: string | null; canonicalName?: string; canonical_name?: string; size: string | null }) =>
      `${(c.brand ?? "").toLowerCase()}|${(c.canonicalName ?? c.canonical_name ?? "").toLowerCase()}|${(c.size ?? "").toLowerCase()}`;
    const sigToId = new Map(existing.map((p) => [sig(p), p.id]));

    for (let i = 0; i < entries.length; i++) {
      const [k, sample] = entries[i];
      const c = classified[i] ?? { brand: null, canonical_name: sample.name, size: null, category: "Other › Uncategorized" };
      const s = sig(c);
      let pid = sigToId.get(s);
      if (!pid) {
        const [row] = await db
          .insert(products)
          .values({
            canonicalName: c.canonical_name,
            brand: c.brand ?? null,
            size: c.size ?? null,
            category: c.category,
            imageUrl: sample.image,
            createdAt: Date.now(),
          })
          .returning({ id: products.id });
        pid = row.id;
        created++;
        sigToId.set(s, pid);
      }
      const sep = k.indexOf(":");
      const kind = k.slice(0, sep) as "upc" | "asin" | "name";
      const value = k.slice(sep + 1);
      await db.insert(productLinks).values({ productId: pid, kind, value });
      linkMap.set(k, pid);
    }
  }

  let resolved = 0;
  for (const it of items) {
    const pid = linkMap.get(itemKey.get(it.id)!);
    if (pid) {
      await db.update(receiptItems).set({ productId: pid }).where(eq(receiptItems.id, it.id));
      resolved++;
    }
  }
  return { resolved, created };
}
