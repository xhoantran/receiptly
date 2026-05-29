/**
 * Drizzle schema — SQLite dialect.
 *
 * This is the ONLY file that is dialect-specific. To migrate to Postgres later:
 *   - swap `sqliteTable` → `pgTable`, `text`/`integer`/`real` → pg column types
 *   - timestamps stored as unix-ms integers here become `timestamp` columns
 * All query code in repo.ts uses Drizzle's builder, which is identical across dialects.
 */
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const plaidItems = sqliteTable("plaid_items", {
  itemId: text("item_id").primaryKey(),
  accessToken: text("access_token").notNull(),
  cursor: text("cursor"),
  institutionName: text("institution_name"),
  createdAt: integer("created_at").notNull(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(), // Plaid transaction_id
    date: text("date").notNull(), // YYYY-MM-DD
    authorizedDatetime: text("authorized_datetime"),
    amount: real("amount").notNull(),
    merchant: text("merchant").notNull(),
    rawName: text("raw_name").notNull(),
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
    accountId: text("account_id").notNull(),
    connectorKey: text("connector_key"), // resolved at insert time, nullable
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    byDate: index("tx_by_date").on(t.date),
    byConnector: index("tx_by_connector").on(t.connectorKey),
    byMerchant: index("tx_by_merchant").on(t.merchant),
  })
);

export const connectors = sqliteTable("connectors", {
  key: text("key").primaryKey(), // "publix"
  displayName: text("display_name").notNull(),
  mode: text("mode", { enum: ["api", "browser"] }).notNull(),
  status: text("status", { enum: ["unlinked", "linked", "error"] })
    .notNull()
    .default("unlinked"),
  lastSyncAt: integer("last_sync_at"),
  lastError: text("last_error"),
});

export const receipts = sqliteTable(
  "receipts",
  {
    id: text("id").primaryKey(), // receipt_id / transactionKey
    connectorKey: text("connector_key").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    store: text("store"),
    total: real("total").notNull(),
    subtotal: real("subtotal"),
    tax: real("tax"),
    raw: text("raw", { mode: "json" }), // original payload for re-parsing
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => ({
    byConnector: index("rcpt_by_connector").on(t.connectorKey),
    byDate: index("rcpt_by_date").on(t.date),
  })
);

// Canonical product — one row per real-world product, deduped across receipts
// and merchants. Receipt line items resolve to these.
export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    canonicalName: text("canonical_name").notNull(),
    brand: text("brand"),
    size: text("size"),
    category: text("category").notNull().default("Other › Uncategorized"),
    imageUrl: text("image_url"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    byCategory: index("prod_by_category").on(t.category),
    byBrand: index("prod_by_brand").on(t.brand),
  })
);

// Alias map: a merchant identifier (UPC, ASIN, or a normalized name slug) → product.
// Lets us recognize the same product next time without re-asking the LLM.
export const productLinks = sqliteTable(
  "product_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull(),
    kind: text("kind", { enum: ["upc", "asin", "name"] }).notNull(),
    value: text("value").notNull(),
  },
  (t) => ({
    byValue: index("plink_by_value").on(t.kind, t.value),
    byProduct: index("plink_by_product").on(t.productId),
  })
);

export const receiptItems = sqliteTable(
  "receipt_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    receiptId: text("receipt_id").notNull(),
    name: text("name").notNull(),
    qty: real("qty").notNull().default(1),
    unit: text("unit").default("ea"),
    unitPrice: real("unit_price"),
    lineTotal: real("line_total").notNull(),
    saving: real("saving").default(0),
    upc: text("upc"),
    imageUrl: text("image_url"),
    productId: integer("product_id"), // resolved canonical product
  },
  (t) => ({
    byReceipt: index("item_by_receipt").on(t.receiptId),
    byName: index("item_by_name").on(t.name),
    byProduct: index("item_by_product").on(t.productId),
  })
);

export const matches = sqliteTable(
  "matches",
  {
    transactionId: text("transaction_id").primaryKey(),
    receiptId: text("receipt_id"),
    confidence: text("confidence", { enum: ["exact", "close", "none"] }).notNull(),
    deltaAmount: real("delta_amount"),
    deltaDays: integer("delta_days"),
    matchedAt: integer("matched_at").notNull(),
  },
  (t) => ({
    byReceipt: index("match_by_receipt").on(t.receiptId),
  })
);

export type ProductRow = typeof products.$inferSelect;
export type ProductLinkRow = typeof productLinks.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type ReceiptRow = typeof receipts.$inferSelect;
export type ReceiptItemRow = typeof receiptItems.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type ConnectorRow = typeof connectors.$inferSelect;
export type PlaidItemRow = typeof plaidItems.$inferSelect;
