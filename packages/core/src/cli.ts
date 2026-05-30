#!/usr/bin/env tsx
/**
 * receiptly — dev/ops CLI.
 *
 * The product is UI-first: connect your bank and merchants in the app, sign in
 * on-device, and receipts ingest + match automatically (no CLI in the user's
 * path). This CLI is only the two commands that have no UI home — both for
 * developers/operators:
 *
 *   receiptly resolve [--force]    (re)link receipt items → canonical products
 *   receiptly discover <merchant>  capture a merchant's traffic to build a connector
 *
 * Database setup lives in package scripts: `pnpm -C packages/core db:migrate` / `db:seed`.
 */
import "./lib/load-env.js"; // must be first: loads repo-root .env before config/db evaluate
import { connectors, connectorsByKey } from "./connectors/index.js";
import { discover } from "./discover.js";
import { resolveProducts } from "./lib/products.js";
import { DEFAULT_USER_ID } from "./lib/constants.js";

const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

function need(key: string) {
  const c = connectorsByKey[key];
  if (!c) {
    console.error(`Unknown merchant "${key}". Known: ${connectors.map((c) => c.key).join(", ")}`);
    process.exit(1);
  }
  return c;
}

async function main() {
  switch (cmd) {
    case "resolve": {
      // Recovery hatch: the /raw ingest resolves products in the background, but if
      // that's interrupted, line items can be left unlinked. This re-links them.
      const { resolved, created } = await resolveProducts(DEFAULT_USER_ID, { force: flags.has("--force") });
      console.log(`Resolved ${resolved} items (${created} new products).`);
      break;
    }
    case "discover": {
      if (!positional[0]) return usage("discover <merchant>");
      need(positional[0]); // validate the key before launching a browser
      await discover(positional[0]);
      break;
    }
    default:
      usage();
  }
}

function usage(hint?: string) {
  if (hint) console.error(`usage: receiptly ${hint}\n`);
  console.log(`receiptly — dev/ops commands (the app itself is UI-first)

  resolve [--force]     (re)link receipt items → canonical products
  discover <merchant>   capture a merchant's traffic to build a connector

  Database setup:  pnpm -C packages/core db:migrate   ·   db:seed`);
}

await main();
