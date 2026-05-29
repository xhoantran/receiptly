/**
 * Repository layer — all data access goes through these functions.
 * Queries use Drizzle's builder (identical across SQLite/Postgres).
 */
import { eq, desc, and, gte, lte, sql, inArray } from "drizzle-orm";
import { db } from "./index.js";
import {
  plaidItems,
  transactions,
  connectors,
  receipts,
  receiptItems,
  matches,
  products,
} from "./schema.js";
import type { Tx } from "../lib/plaid.js";
import type { ExtractedReceipt } from "../lib/extract.js";

const now = () => Date.now();

// ─── Plaid items ───
export async function savePlaidItem(item: {
  itemId: string;
  accessToken: string;
  institutionName?: string;
}) {
  await db
    .insert(plaidItems)
    .values({ ...item, createdAt: now() })
    .onConflictDoUpdate({
      target: plaidItems.itemId,
      set: { accessToken: item.accessToken },
    });
}

export async function listPlaidItems() {
  return db.select().from(plaidItems);
}

export async function updateCursor(itemId: string, cursor: string) {
  await db.update(plaidItems).set({ cursor }).where(eq(plaidItems.itemId, itemId));
}

// ─── Transactions ───
export async function upsertTransactions(txs: Tx[], resolveConnector: (tx: Tx) => string | null) {
  if (txs.length === 0) return;
  const rows = txs.map((t) => ({
    id: t.id,
    date: t.date,
    authorizedDatetime: t.authorized_datetime,
    amount: t.amount,
    merchant: t.merchant,
    rawName: t.raw_name,
    pending: t.pending,
    accountId: t.account_id,
    connectorKey: resolveConnector(t),
    createdAt: now(),
  }));
  for (const row of rows) {
    await db
      .insert(transactions)
      .values(row)
      .onConflictDoUpdate({
        target: transactions.id,
        set: { pending: row.pending, amount: row.amount, connectorKey: row.connectorKey },
      });
  }
}

export type TxFilter = {
  connectorKey?: string;
  merchant?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  limit?: number;
};

export async function listTransactions(filter: TxFilter = {}) {
  const conds = [];
  if (filter.connectorKey) conds.push(eq(transactions.connectorKey, filter.connectorKey));
  if (filter.merchant) conds.push(eq(transactions.merchant, filter.merchant));
  if (filter.from) conds.push(gte(transactions.date, filter.from));
  if (filter.to) conds.push(lte(transactions.date, filter.to));

  let q = db.select().from(transactions).$dynamic();
  if (conds.length) q = q.where(and(...conds));
  q = q.orderBy(desc(transactions.date));
  if (filter.limit) q = q.limit(filter.limit);
  return q;
}

export async function getTransaction(id: string) {
  const [t] = await db.select().from(transactions).where(eq(transactions.id, id));
  return t ?? null;
}

export async function merchantSummary() {
  return db
    .select({
      merchant: transactions.merchant,
      connectorKey: transactions.connectorKey,
      count: sql<number>`count(*)`,
      total: sql<number>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .groupBy(transactions.merchant, transactions.connectorKey)
    .orderBy(desc(sql`count(*)`));
}

// ─── Connectors ───
export async function upsertConnector(c: {
  key: string;
  displayName: string;
  mode: "api" | "browser";
}) {
  await db
    .insert(connectors)
    .values({ ...c })
    .onConflictDoUpdate({
      target: connectors.key,
      set: { displayName: c.displayName, mode: c.mode },
    });
}

export async function markConnectorSynced(key: string, error?: string) {
  await db
    .update(connectors)
    .set({
      status: error ? "error" : "linked",
      lastSyncAt: now(),
      lastError: error ?? null,
    })
    .where(eq(connectors.key, key));
}

export async function listConnectors() {
  return db.select().from(connectors);
}

/** Per-connector receipt + item counts — used to mark a connector "live" vs stub. */
export async function connectorStats() {
  return db
    .select({
      connectorKey: receipts.connectorKey,
      receipts: sql<number>`count(distinct ${receipts.id})`,
      items: sql<number>`count(${receiptItems.id})`,
    })
    .from(receipts)
    .leftJoin(receiptItems, eq(receiptItems.receiptId, receipts.id))
    .groupBy(receipts.connectorKey);
}

// ─── Receipts + items ───
export async function saveReceipts(connectorKey: string, list: ExtractedReceipt[]) {
  for (const r of list) {
    const id = String(r.receipt_id ?? `${connectorKey}-${r.date}-${r.total}`);
    await db
      .insert(receipts)
      .values({
        id,
        connectorKey,
        date: r.date,
        store: r.store ?? null,
        total: r.total,
        subtotal: r.subtotal ?? null,
        tax: r.tax ?? null,
        raw: r as unknown,
        fetchedAt: now(),
      })
      .onConflictDoUpdate({
        target: receipts.id,
        set: { total: r.total, store: r.store ?? null, fetchedAt: now() },
      });

    // Replace items for this receipt
    await db.delete(receiptItems).where(eq(receiptItems.receiptId, id));
    if (r.items.length) {
      await db.insert(receiptItems).values(
        r.items.map((it) => ({
          receiptId: id,
          name: it.name,
          qty: it.qty,
          unit: it.unit ?? "ea",
          unitPrice: it.unit_price ?? null,
          lineTotal: it.line_total,
          saving: it.saving ?? 0,
          imageUrl: it.image_url ?? null,
        }))
      );
    }
  }
}

export async function getReceiptWithItems(receiptId: string) {
  const [receipt] = await db.select().from(receipts).where(eq(receipts.id, receiptId));
  if (!receipt) return null;
  const items = await db.select().from(receiptItems).where(eq(receiptItems.receiptId, receiptId));
  return { ...receipt, items };
}

export async function listReceipts(connectorKey?: string) {
  let q = db.select().from(receipts).$dynamic();
  if (connectorKey) q = q.where(eq(receipts.connectorKey, connectorKey));
  return q.orderBy(desc(receipts.date));
}

// ─── Matches ───
export async function saveMatches(
  rows: { transactionId: string; receiptId: string | null; confidence: "exact" | "close" | "none"; deltaAmount?: number; deltaDays?: number }[]
) {
  for (const m of rows) {
    await db
      .insert(matches)
      .values({
        transactionId: m.transactionId,
        receiptId: m.receiptId,
        confidence: m.confidence,
        deltaAmount: m.deltaAmount ?? null,
        deltaDays: m.deltaDays ?? null,
        matchedAt: now(),
      })
      .onConflictDoUpdate({
        target: matches.transactionId,
        set: { receiptId: m.receiptId, confidence: m.confidence, matchedAt: now() },
      });
  }
}

export async function getMatchForTransaction(txId: string) {
  const [m] = await db.select().from(matches).where(eq(matches.transactionId, txId));
  if (!m || !m.receiptId) return null;
  return getReceiptWithItems(m.receiptId);
}

// ─── Analytics for the agent ───
export async function spendingByItem(opts: { from?: string; to?: string; like?: string } = {}) {
  const conds = [];
  if (opts.from) conds.push(gte(receipts.date, opts.from));
  if (opts.to) conds.push(lte(receipts.date, opts.to));
  if (opts.like) conds.push(sql`lower(${receiptItems.name}) like ${"%" + opts.like.toLowerCase() + "%"}`);

  let q = db
    .select({
      name: receiptItems.name,
      timesBought: sql<number>`count(*)`,
      totalQty: sql<number>`sum(${receiptItems.qty})`,
      totalSpent: sql<number>`sum(${receiptItems.lineTotal})`,
      totalSaved: sql<number>`sum(${receiptItems.saving})`,
      avgPrice: sql<number>`avg(${receiptItems.unitPrice})`,
      imageUrl: sql<string | null>`max(${receiptItems.imageUrl})`,
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
    .$dynamic();
  if (conds.length) q = q.where(and(...conds));
  return q.groupBy(receiptItems.name).orderBy(desc(sql`sum(${receiptItems.lineTotal})`));
}

export async function savingsSummary(opts: { from?: string; to?: string } = {}) {
  const conds = [sql`${receiptItems.saving} > 0`];
  if (opts.from) conds.push(gte(receipts.date, opts.from));
  if (opts.to) conds.push(lte(receipts.date, opts.to));

  const [totals] = await db
    .select({
      totalSaved: sql<number>`coalesce(sum(${receiptItems.saving}), 0)`,
      discountedItems: sql<number>`count(*)`,
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
    .where(and(...conds));

  const topSaved = await db
    .select({
      name: receiptItems.name,
      saved: sql<number>`sum(${receiptItems.saving})`,
      times: sql<number>`count(*)`,
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
    .where(and(...conds))
    .groupBy(receiptItems.name)
    .orderBy(desc(sql`sum(${receiptItems.saving})`))
    .limit(15);

  return { totalSaved: totals?.totalSaved ?? 0, discountedItems: totals?.discountedItems ?? 0, topSaved };
}

// ─── Canonical products / categories (cross-merchant) ───

/** Spend grouped by category, across every merchant. */
export async function spendingByCategory() {
  return db
    .select({
      category: products.category,
      totalSpent: sql<number>`sum(${receiptItems.lineTotal})`,
      items: sql<number>`count(${receiptItems.id})`,
      products: sql<number>`count(distinct ${products.id})`,
    })
    .from(receiptItems)
    .innerJoin(products, eq(receiptItems.productId, products.id))
    .groupBy(products.category)
    .orderBy(desc(sql`sum(${receiptItems.lineTotal})`));
}

/** Canonical products with spend + cross-merchant price spread. */
export async function canonicalProducts(opts: { category?: string; limit?: number } = {}) {
  let q = db
    .select({
      id: products.id,
      name: products.canonicalName,
      brand: products.brand,
      size: products.size,
      category: products.category,
      imageUrl: products.imageUrl,
      timesBought: sql<number>`count(${receiptItems.id})`,
      totalSpent: sql<number>`sum(${receiptItems.lineTotal})`,
      totalSaved: sql<number>`sum(${receiptItems.saving})`,
      minUnit: sql<number>`min(${receiptItems.unitPrice})`,
      maxUnit: sql<number>`max(${receiptItems.unitPrice})`,
      merchants: sql<number>`count(distinct ${receipts.connectorKey})`,
    })
    .from(products)
    .innerJoin(receiptItems, eq(receiptItems.productId, products.id))
    .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
    .$dynamic();
  if (opts.category) q = q.where(eq(products.category, opts.category));
  q = q.groupBy(products.id).orderBy(desc(sql`sum(${receiptItems.lineTotal})`));
  if (opts.limit) q = q.limit(opts.limit);
  return q;
}

/** Per-merchant unit price for one product — powers "where's it cheapest". */
export async function productPriceByMerchant(productId: number) {
  return db
    .select({
      merchant: receipts.connectorKey,
      times: sql<number>`count(*)`,
      avgUnit: sql<number>`avg(${receiptItems.unitPrice})`,
      minUnit: sql<number>`min(${receiptItems.unitPrice})`,
      lastDate: sql<string>`max(${receipts.date})`,
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
    .where(eq(receiptItems.productId, productId))
    .groupBy(receipts.connectorKey)
    .orderBy(sql`avg(${receiptItems.unitPrice})`);
}

export async function priceHistory(itemLike: string) {
  return db
    .select({
      date: receipts.date,
      store: receipts.store,
      name: receiptItems.name,
      unitPrice: receiptItems.unitPrice,
      qty: receiptItems.qty,
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
    .where(sql`lower(${receiptItems.name}) like ${"%" + itemLike.toLowerCase() + "%"}`)
    .orderBy(receipts.date);
}

export async function coverageStats() {
  const allTx = await db
    .select({
      connectorKey: transactions.connectorKey,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(sql`${transactions.connectorKey} is not null`)
    .groupBy(transactions.connectorKey);

  const matched = await db
    .select({
      connectorKey: transactions.connectorKey,
      count: sql<number>`count(*)`,
    })
    .from(matches)
    .innerJoin(transactions, eq(matches.transactionId, transactions.id))
    .where(and(sql`${matches.receiptId} is not null`, eq(matches.confidence, "exact")))
    .groupBy(transactions.connectorKey);

  const matchedMap = new Map(matched.map((m) => [m.connectorKey, m.count]));
  return allTx.map((t) => ({
    connectorKey: t.connectorKey,
    transactions: t.count,
    matched: matchedMap.get(t.connectorKey) ?? 0,
  }));
}
