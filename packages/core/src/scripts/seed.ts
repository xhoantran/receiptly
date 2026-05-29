/**
 * Seed the single Phase-0 tenant.
 *
 * Every engine call is threaded a `userId`; in Phase 0 that is always
 * `DEFAULT_USER_ID`. The per-user app tables (plaid_items, transactions,
 * receipts, …) all FK to `user.id`, so that row must exist before any sync.
 * This script idempotently inserts it (on-conflict do nothing), so it is safe
 * to re-run.
 *
 * Run with: pnpm -C packages/core db:seed   (loads repo-root .env)
 */
import "../lib/load-env.js"; // must be first: loads repo-root .env before db evaluates
import { db } from "../db/index.js";
import { user } from "../db/schema.js";
import { DEFAULT_USER_ID } from "../lib/constants.js";

async function main() {
  const now = new Date();
  await db
    .insert(user)
    .values({
      id: DEFAULT_USER_ID,
      name: "Default User",
      email: "default@receiptly.local",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: user.id });

  console.log(`Seeded default user "${DEFAULT_USER_ID}" (idempotent).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
