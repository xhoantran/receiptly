// Barrel re-exporting the public surface of @receiptly/core.
// Consumers (apps/web, cli) import from "@receiptly/core" instead of relative paths.
// Later Phase-0 stages append crypto/auth/constants exports here.
export * from "./db/repo.js";
export * from "./connectors/index.js";
export * from "./connectors/types.js";
export * from "./lib/plaid.js";
export * from "./lib/plaid-sync.js";
export * from "./lib/ingest.js";
export * from "./lib/products.js";
export * from "./lib/extract.js";
export * from "./session.js";
export * from "./lib/constants.js";
export * from "./lib/crypto.js";
export * from "./lib/auth.js";
