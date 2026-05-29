/**
 * Drizzle schema — Postgres dialect.
 *
 * Multi-tenant. Per-user tables carry `userId` (FK → user.id); the canonical
 * product catalog (`products` + `productLinks`) stays GLOBAL/shared. The
 * connector *registry* (key/displayName/mode) lives in code
 * (connectors/index.ts) — only per-user connector *state* lives in the DB
 * (merchantConnections / merchantSessions).
 *
 * Timestamp convention: app-table epoch-millisecond columns (createdAt,
 * fetchedAt, lastSyncAt, matchedAt, …) stay `bigint({ mode: "number" })` so the
 * existing `Date.now()` insert logic is untouched (Phase 0 = no behavior
 * change). The Better Auth tables are the exception — Better Auth hands Drizzle
 * real `Date` objects, so those use `timestamp({ withTimezone: true })`.
 *
 * All query code in repo.ts uses Drizzle's builder, which is identical across
 * dialects.
 */
import {
  pgTable,
  text,
  boolean,
  doublePrecision,
  bigint,
  serial,
  integer,
  jsonb,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── Better Auth core tables (hand-written, pg). ───
// Real timestamps (Better Auth expects Date), NOT epoch bigint.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

// ─── Per-user app tables. ───

export const plaidItems = pgTable(
  "plaid_items",
  {
    itemId: text("item_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    accessToken: text("access_token").notNull(),
    cursor: text("cursor"),
    institutionName: text("institution_name"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("plaid_items_by_user").on(t.userId)]
);

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(), // Plaid transaction_id
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    date: text("date").notNull(), // YYYY-MM-DD
    authorizedDatetime: text("authorized_datetime"),
    amount: doublePrecision("amount").notNull(),
    merchant: text("merchant").notNull(),
    rawName: text("raw_name").notNull(),
    pending: boolean("pending").notNull().default(false),
    accountId: text("account_id").notNull(),
    connectorKey: text("connector_key"), // resolved at insert time, nullable
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("tx_by_user").on(t.userId),
    index("tx_by_user_date").on(t.userId, t.date),
    index("tx_by_user_connector").on(t.userId, t.connectorKey),
    index("tx_by_user_merchant").on(t.userId, t.merchant),
  ]
);

// Per-user connector STATE. The registry (key/displayName/mode) lives in code.
export const merchantConnections = pgTable(
  "merchant_connections",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    connectorKey: text("connector_key").notNull(),
    status: text("status", { enum: ["unlinked", "linked", "error"] })
      .notNull()
      .default("unlinked"),
    lastSyncAt: bigint("last_sync_at", { mode: "number" }),
    lastError: text("last_error"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.connectorKey] })]
);

// Per-user encrypted merchant browser sessions (storageState).
export const merchantSessions = pgTable(
  "merchant_sessions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    connectorKey: text("connector_key").notNull(),
    encryptedState: text("encrypted_state"),
    expiresAt: bigint("expires_at", { mode: "number" }),
    status: text("status").notNull().default("active"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.connectorKey] })]
);

export const receipts = pgTable(
  "receipts",
  {
    id: text("id").primaryKey(), // receipt_id / transactionKey
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    connectorKey: text("connector_key").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    store: text("store"),
    total: doublePrecision("total").notNull(),
    subtotal: doublePrecision("subtotal"),
    tax: doublePrecision("tax"),
    raw: jsonb("raw"), // original payload for re-parsing
    fetchedAt: bigint("fetched_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("rcpt_by_user").on(t.userId),
    index("rcpt_by_user_connector").on(t.userId, t.connectorKey),
    index("rcpt_by_user_date").on(t.userId, t.date),
  ]
);

// Canonical product — one row per real-world product, deduped across receipts
// and merchants. GLOBAL (shared catalog, no PII). Receipt line items resolve to
// these.
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    brand: text("brand"),
    size: text("size"),
    category: text("category").notNull().default("Other › Uncategorized"),
    imageUrl: text("image_url"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("prod_by_category").on(t.category),
    index("prod_by_brand").on(t.brand),
  ]
);

// Alias map: a merchant identifier (UPC, ASIN, or a normalized name slug) → product.
// Lets us recognize the same product next time without re-asking the LLM. GLOBAL.
export const productLinks = pgTable(
  "product_links",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull(),
    kind: text("kind", { enum: ["upc", "asin", "name"] }).notNull(),
    value: text("value").notNull(),
  },
  (t) => [
    index("plink_by_value").on(t.kind, t.value),
    index("plink_by_product").on(t.productId),
  ]
);

export const receiptItems = pgTable(
  "receipt_items",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    receiptId: text("receipt_id").notNull(),
    name: text("name").notNull(),
    qty: doublePrecision("qty").notNull().default(1),
    unit: text("unit").default("ea"),
    unitPrice: doublePrecision("unit_price"),
    lineTotal: doublePrecision("line_total").notNull(),
    saving: doublePrecision("saving").default(0),
    upc: text("upc"),
    imageUrl: text("image_url"),
    productId: integer("product_id"), // resolved canonical product (global)
  },
  (t) => [
    index("item_by_user").on(t.userId),
    index("item_by_receipt").on(t.receiptId),
    index("item_by_name").on(t.name),
    index("item_by_product").on(t.productId),
  ]
);

export const matches = pgTable(
  "matches",
  {
    transactionId: text("transaction_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    receiptId: text("receipt_id"),
    confidence: text("confidence", { enum: ["exact", "close", "none"] }).notNull(),
    deltaAmount: doublePrecision("delta_amount"),
    deltaDays: integer("delta_days"),
    matchedAt: bigint("matched_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("match_by_user").on(t.userId),
    index("match_by_receipt").on(t.receiptId),
  ]
);

export type ProductRow = typeof products.$inferSelect;
export type ProductLinkRow = typeof productLinks.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type ReceiptRow = typeof receipts.$inferSelect;
export type ReceiptItemRow = typeof receiptItems.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type PlaidItemRow = typeof plaidItems.$inferSelect;
export type MerchantConnectionRow = typeof merchantConnections.$inferSelect;
export type MerchantSessionRow = typeof merchantSessions.$inferSelect;

// Better Auth row types.
export type UserRow = typeof user.$inferSelect;
export type SessionRow = typeof session.$inferSelect;
export type AccountRow = typeof account.$inferSelect;
export type VerificationRow = typeof verification.$inferSelect;
