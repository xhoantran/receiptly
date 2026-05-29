/**
 * Repository layer — all data access goes through these functions.
 * Queries use Drizzle's builder (identical across SQLite/Postgres).
 *
 * Multi-tenancy: every function that reads or writes a per-user table takes a
 * LEADING `userId: string` argument, adds `eq(table.userId, userId)` on reads,
 * and sets `userId` on inserts. Functions that touch ONLY the global catalog
 * (`products` / `productLinks`) stay global. Aggregations that join
 * `receipt_items` are scoped by `userId` so one tenant never sees another's
 * spend.
 *
 * The connector REGISTRY (key/displayName/mode) lives in code
 * (connectors/index.ts); the DB only holds per-user connector STATE
 * (`merchant_connections`). The connector functions below merge the two.
 */
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { db } from "./index.js";
import {
  plaidItems,
  transactions,
  merchantConnections,
  merchantSessions,
  receipts,
  receiptItems,
  matches,
  products,
} from "./schema.js";
import { connectors } from "../connectors/index.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import type { Tx } from "../lib/plaid.js";
import type { ExtractedReceipt } from "../lib/extract.js";

const now = () => Date.now();

// ─── Plaid items ───
// The `access_token` column holds AES-256-GCM ciphertext at rest. We encrypt on
// the way in (savePlaidItem) and decrypt on the way out (listPlaidItems) so the
// rest of the engine still sees a plaintext token. The column name is unchanged.
export async function savePlaidItem(
  userId: string,
  item: {
    itemId: string;
    accessToken: string;
    institutionName?: string;
  }
) {
  const accessToken = encrypt(item.accessToken);
  await db
    .insert(plaidItems)
    .values({ ...item, accessToken, userId, createdAt: now() })
    .onConflictDoUpdate({
      target: plaidItems.itemId,
      set: { accessToken },
    });
}

export async function listPlaidItems(userId: string) {
  const rows = await db.select().from(plaidItems).where(eq(plaidItems.userId, userId));
  return rows.map((row) => ({ ...row, accessToken: decrypt(row.accessToken) }));
}

export async function updateCursor(userId: string, itemId: string, cursor: string) {
  await db
    .update(plaidItems)
    .set({ cursor })
    .where(and(eq(plaidItems.userId, userId), eq(plaidItems.itemId, itemId)));
}

// ─── Transactions ───
export async function upsertTransactions(
  userId: string,
  txs: Tx[],
  resolveConnector: (tx: Tx) => string | null
) {
  if (txs.length === 0) return;
  const rows = txs.map((t) => ({
    id: t.id,
    userId,
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

export async function listTransactions(userId: string, filter: TxFilter = {}) {
  const conds = [eq(transactions.userId, userId)];
  if (filter.connectorKey) conds.push(eq(transactions.connectorKey, filter.connectorKey));
  if (filter.merchant) conds.push(eq(transactions.merchant, filter.merchant));
  if (filter.from) conds.push(gte(transactions.date, filter.from));
  if (filter.to) conds.push(lte(transactions.date, filter.to));

  let q = db.select().from(transactions).$dynamic();
  q = q.where(and(...conds));
  q = q.orderBy(desc(transactions.date));
  if (filter.limit) q = q.limit(filter.limit);
  return q;
}

export async function getTransaction(userId: string, id: string) {
  const [t] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
  return t ?? null;
}

export async function merchantSummary(userId: string) {
  return db
    .select({
      merchant: transactions.merchant,
      connectorKey: transactions.connectorKey,
      count: sql<number>`count(*)`,
      total: sql<number>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .groupBy(transactions.merchant, transactions.connectorKey)
    .orderBy(desc(sql`count(*)`));
}

// ─── Connectors (per-user state ⨝ in-code registry) ───

/** Shape callers expect — mirrors the old single `connectors` row. */
export type ConnectorRow = {
  key: string;
  displayName: string;
  mode: "api" | "browser";
  status: "unlinked" | "linked" | "error";
  lastSyncAt: number | null;
  lastError: string | null;
};

/** Ensure a per-user connection row exists for this connector (status only). */
export async function upsertConnector(
  userId: string,
  c: {
    key: string;
    displayName: string;
    mode: "api" | "browser";
  }
) {
  await db
    .insert(merchantConnections)
    .values({ userId, connectorKey: c.key })
    .onConflictDoNothing({ target: [merchantConnections.userId, merchantConnections.connectorKey] });
}

export async function markConnectorSynced(userId: string, key: string, error?: string) {
  await db
    .insert(merchantConnections)
    .values({
      userId,
      connectorKey: key,
      status: error ? "error" : "linked",
      lastSyncAt: now(),
      lastError: error ?? null,
    })
    .onConflictDoUpdate({
      target: [merchantConnections.userId, merchantConnections.connectorKey],
      set: {
        status: error ? "error" : "linked",
        lastSyncAt: now(),
        lastError: error ?? null,
      },
    });
}

// ─── Merchant browser sessions (encrypted storageState) ───
// The `encrypted_state` column holds AES-256-GCM ciphertext of the Playwright
// storageState JSON — same at-rest pattern as Plaid access tokens above. The
// live-view worker writes here on a successful interactive login; the scrape
// worker reads it back to restore the authenticated context headlessly.

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function saveMerchantSession(
  userId: string,
  connectorKey: string,
  storageStateJson: string
) {
  const encryptedState = encrypt(storageStateJson);
  const expiresAt = now() + SESSION_TTL_MS;
  await db
    .insert(merchantSessions)
    .values({ userId, connectorKey, encryptedState, expiresAt, status: "active" })
    .onConflictDoUpdate({
      target: [merchantSessions.userId, merchantSessions.connectorKey],
      set: { encryptedState, expiresAt, status: "active" },
    });
}

export async function getMerchantSession(
  userId: string,
  connectorKey: string
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(merchantSessions)
    .where(
      and(
        eq(merchantSessions.userId, userId),
        eq(merchantSessions.connectorKey, connectorKey)
      )
    );
  if (!row || !row.encryptedState) return null;
  return decrypt(row.encryptedState);
}

export async function getMerchantConnection(
  userId: string,
  connectorKey: string
): Promise<{ status: "unlinked" | "linked" | "error"; lastSyncAt: number | null; lastError: string | null } | null> {
  const [row] = await db
    .select({
      status: merchantConnections.status,
      lastSyncAt: merchantConnections.lastSyncAt,
      lastError: merchantConnections.lastError,
    })
    .from(merchantConnections)
    .where(
      and(
        eq(merchantConnections.userId, userId),
        eq(merchantConnections.connectorKey, connectorKey)
      )
    );
  return row ?? null;
}

export async function setMerchantConnectionStatus(
  userId: string,
  connectorKey: string,
  status: "unlinked" | "linked" | "error",
  opts: { lastError?: string | null; lastSyncAt?: number } = {}
) {
  const set: { status: typeof status; lastError?: string | null; lastSyncAt?: number } = { status };
  if ("lastError" in opts) set.lastError = opts.lastError ?? null;
  if (opts.lastSyncAt !== undefined) set.lastSyncAt = opts.lastSyncAt;
  await db
    .insert(merchantConnections)
    .values({
      userId,
      connectorKey,
      status,
      lastError: opts.lastError ?? null,
      lastSyncAt: opts.lastSyncAt ?? null,
    })
    .onConflictDoUpdate({
      target: [merchantConnections.userId, merchantConnections.connectorKey],
      set,
    });
}

/**
 * The connector registry (from code) merged with this user's per-connector
 * state (from the DB). Every registered connector appears; ones the user has no
 * row for default to "unlinked".
 */
export async function listConnectors(userId: string): Promise<ConnectorRow[]> {
  const state = await db
    .select()
    .from(merchantConnections)
    .where(eq(merchantConnections.userId, userId));
  const byKey = new Map(state.map((s) => [s.connectorKey, s]));
  return connectors.map((c) => {
    const s = byKey.get(c.key);
    return {
      key: c.key,
      displayName: c.displayName,
      mode: c.mode,
      status: s?.status ?? "unlinked",
      lastSyncAt: s?.lastSyncAt ?? null,
      lastError: s?.lastError ?? null,
    };
  });
}

/** Per-connector receipt + item counts — used to mark a connector "live" vs stub. */
export async function connectorStats(userId: string) {
  return db
    .select({
      connectorKey: receipts.connectorKey,
      receipts: sql<number>`count(distinct ${receipts.id})`,
      items: sql<number>`count(${receiptItems.id})`,
    })
    .from(receipts)
    .leftJoin(receiptItems, eq(receiptItems.receiptId, receipts.id))
    .where(eq(receipts.userId, userId))
    .groupBy(receipts.connectorKey);
}

// ─── Receipts + items ───
export async function saveReceipts(userId: string, connectorKey: string, list: ExtractedReceipt[]) {
  for (const r of list) {
    const id = String(r.receipt_id ?? `${connectorKey}-${r.date}-${r.total}`);
    await db
      .insert(receipts)
      .values({
        id,
        userId,
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
          userId,
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

export async function getReceiptWithItems(userId: string, receiptId: string) {
  const [receipt] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.userId, userId), eq(receipts.id, receiptId)));
  if (!receipt) return null;
  const items = await db.select().from(receiptItems).where(eq(receiptItems.receiptId, receiptId));
  return { ...receipt, items };
}

export async function listReceipts(userId: string, connectorKey?: string) {
  const conds = [eq(receipts.userId, userId)];
  if (connectorKey) conds.push(eq(receipts.connectorKey, connectorKey));
  return db
    .select()
    .from(receipts)
    .where(and(...conds))
    .orderBy(desc(receipts.date));
}

// ─── Matches ───
export async function saveMatches(
  userId: string,
  rows: { transactionId: string; receiptId: string | null; confidence: "exact" | "close" | "none"; deltaAmount?: number; deltaDays?: number }[]
) {
  for (const m of rows) {
    await db
      .insert(matches)
      .values({
        transactionId: m.transactionId,
        userId,
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

export async function getMatchForTransaction(userId: string, txId: string) {
  const [m] = await db
    .select()
    .from(matches)
    .where(and(eq(matches.userId, userId), eq(matches.transactionId, txId)));
  if (!m || !m.receiptId) return null;
  return getReceiptWithItems(userId, m.receiptId);
}

// ─── Analytics for the agent ───
export async function spendingByItem(
  userId: string,
  opts: { from?: string; to?: string; like?: string } = {}
) {
  const conds = [eq(receipts.userId, userId)];
  if (opts.from) conds.push(gte(receipts.date, opts.from));
  if (opts.to) conds.push(lte(receipts.date, opts.to));
  if (opts.like) conds.push(sql`lower(${receiptItems.name}) like ${"%" + opts.like.toLowerCase() + "%"}`);

  return db
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
    .where(and(...conds))
    .groupBy(receiptItems.name)
    .orderBy(desc(sql`sum(${receiptItems.lineTotal})`));
}

export async function savingsSummary(userId: string, opts: { from?: string; to?: string } = {}) {
  const conds = [eq(receipts.userId, userId), sql`${receiptItems.saving} > 0`];
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

// ─── Canonical products / categories (cross-merchant, per-user spend) ───

/** Spend grouped by category, across every merchant — scoped to this user. */
export async function spendingByCategory(userId: string) {
  return db
    .select({
      category: products.category,
      totalSpent: sql<number>`sum(${receiptItems.lineTotal})`,
      items: sql<number>`count(${receiptItems.id})`,
      products: sql<number>`count(distinct ${products.id})`,
    })
    .from(receiptItems)
    .innerJoin(products, eq(receiptItems.productId, products.id))
    .where(eq(receiptItems.userId, userId))
    .groupBy(products.category)
    .orderBy(desc(sql`sum(${receiptItems.lineTotal})`));
}

/** Canonical products with this user's spend + cross-merchant price spread. */
export async function canonicalProducts(
  userId: string,
  opts: { category?: string; limit?: number } = {}
) {
  const conds = [eq(receiptItems.userId, userId)];
  if (opts.category) conds.push(eq(products.category, opts.category));

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
  q = q.where(and(...conds));
  q = q.groupBy(products.id).orderBy(desc(sql`sum(${receiptItems.lineTotal})`));
  if (opts.limit) q = q.limit(opts.limit);
  return q;
}

/** Per-merchant unit price for one product — powers "where's it cheapest". */
export async function productPriceByMerchant(userId: string, productId: number) {
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
    .where(and(eq(receiptItems.userId, userId), eq(receiptItems.productId, productId)))
    .groupBy(receipts.connectorKey)
    .orderBy(sql`avg(${receiptItems.unitPrice})`);
}

export async function priceHistory(userId: string, itemLike: string) {
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
    .where(
      and(
        eq(receiptItems.userId, userId),
        sql`lower(${receiptItems.name}) like ${"%" + itemLike.toLowerCase() + "%"}`
      )
    )
    .orderBy(receipts.date);
}

export async function coverageStats(userId: string) {
  const allTx = await db
    .select({
      connectorKey: transactions.connectorKey,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), sql`${transactions.connectorKey} is not null`))
    .groupBy(transactions.connectorKey);

  const matched = await db
    .select({
      connectorKey: transactions.connectorKey,
      count: sql<number>`count(*)`,
    })
    .from(matches)
    .innerJoin(transactions, eq(matches.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.userId, userId),
        sql`${matches.receiptId} is not null`,
        eq(matches.confidence, "exact")
      )
    )
    .groupBy(transactions.connectorKey);

  const matchedMap = new Map(matched.map((m) => [m.connectorKey, m.count]));
  return allTx.map((t) => ({
    connectorKey: t.connectorKey,
    transactions: t.count,
    matched: matchedMap.get(t.connectorKey) ?? 0,
  }));
}
