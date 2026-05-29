#!/usr/bin/env tsx
/**
 * receiptly — one CLI for everything.
 *
 *   receiptly init                 set up the local database + seed connectors
 *   receiptly link                 open the Plaid Link UI to connect a bank
 *   receiptly sync                 pull new transactions from Plaid
 *   receiptly login <merchant>     sign in to a merchant (saves the session)
 *   receiptly scrape <merchant…>   fetch receipts using the saved session
 *   receiptly discover <merchant>  capture a merchant's traffic to build a connector
 *   receiptly merchants            list connectors + session status
 *   receiptly tx                   show transactions grouped by merchant
 *   receiptly resolve [--force]    (re)resolve items into canonical products
 */
import "./lib/load-env.js"; // must be first: loads repo-root .env before config/db evaluate
import { connectors, connectorsByKey } from "./connectors/index.js";
import { login, withSession, listSessions, hasSession } from "./session.js";
import { ingest } from "./lib/ingest.js";
import { discover } from "./discover.js";
import { resolveProducts } from "./lib/products.js";
import { syncAll } from "./lib/plaid-sync.js";
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

async function scrapeOne(key: string) {
  const connector = need(key);
  console.log(`\n=== ${connector.displayName} ===`);
  // withSession opens the browser, signs in only if needed, then scrapes.
  const receipts =
    connector.mode === "browser"
      ? await withSession(connector, (page) => connector.fetchReceipts({ page }))
      : await connector.fetchReceipts({ page: undefined as never });
  const r = await ingest(DEFAULT_USER_ID, key, receipts);
  console.log(
    `[${key}] ${r.receipts} receipts · ${r.matched}/${r.total} matched · ${r.resolved} items → products`
  );
}

async function main() {
  switch (cmd) {
    case "init": {
      const { upsertConnector } = await import("./db/repo.js");
      for (const c of connectors) await upsertConnector(DEFAULT_USER_ID, { key: c.key, displayName: c.displayName, mode: c.mode });
      console.log(`Seeded ${connectors.length} connectors. (Run \`pnpm -C packages/core db:migrate\` first for a fresh database.)`);
      break;
    }
    case "link": {
      console.log("Starting Plaid Link UI…");
      await import("./server.js"); // starts the express server
      break;
    }
    case "sync": {
      const { items, added } = await syncAll(DEFAULT_USER_ID);
      console.log(`Synced ${items} linked item(s): ${added} new transactions.`);
      break;
    }
    case "login": {
      if (!positional[0]) return usage("login <merchant>");
      await login(need(positional[0]));
      break;
    }
    case "scrape": {
      // Explicit merchant(s) → scrape those (auto-login if needed).
      if (positional.length) {
        for (const k of positional) {
          try { await scrapeOne(k); }
          catch (err) { console.error(`[${k}] ✗ ${err instanceof Error ? err.message : String(err)}`); }
        }
        break;
      }

      // No args → driven by your transactions: which merchants you actually shop
      // at, and which charges still have no receipt. Only fetch what's missing.
      const { coverageStats } = await import("./db/repo.js");
      const work = (await coverageStats(DEFAULT_USER_ID))
        .filter((c) => c.connectorKey && connectorsByKey[c.connectorKey])
        .map((c) => ({ key: c.connectorKey!, total: c.transactions, missing: c.transactions - c.matched }))
        .filter((c) => c.missing > 0)
        .sort((a, b) => b.missing - a.missing);

      if (work.length === 0) {
        console.log("All caught up — every charge from a supported merchant already has a receipt. 🎉");
        break;
      }

      console.log("Receipts to fetch, based on your transactions:");
      for (const w of work) {
        console.log(`  ${w.key.padEnd(10)} ${w.missing} missing of ${w.total} charges${hasSession(w.key) ? "" : "   (needs first sign-in)"}`);
      }

      // Auto-run merchants you're already signed into; the rest just need one sign-in.
      const ready = work.filter((w) => hasSession(w.key));
      const needLogin = work.filter((w) => !hasSession(w.key));
      for (const w of ready) {
        try { await scrapeOne(w.key); }
        catch (err) { console.error(`[${w.key}] ✗ ${err instanceof Error ? err.message : String(err)}`); }
      }
      if (needLogin.length) {
        console.log(`\nTo connect the rest (one-time sign-in each):`);
        for (const w of needLogin) console.log(`  receiptly scrape ${w.key}`);
      }
      break;
    }
    case "discover": {
      if (!positional[0]) return usage("discover <merchant>");
      await discover(positional[0]);
      break;
    }
    case "merchants": {
      const sessions = new Map(listSessions(connectors.map((c) => c.key)).map((s) => [s.key, s.saved]));
      console.log("Connectors:");
      for (const c of connectors) {
        console.log(`  ${c.key.padEnd(12)} ${c.mode.padEnd(8)} ${sessions.get(c.key) ? "🟢 session" : "⚪ no session"}`);
      }
      break;
    }
    case "tx": {
      const { merchantSummary } = await import("./db/repo.js");
      const rows = await merchantSummary(DEFAULT_USER_ID);
      for (const m of rows.slice(0, 25)) {
        const c = m.connectorKey ? `  [${m.connectorKey}]` : "";
        console.log(`  ${String(m.count).padStart(3)}  $${(m.total ?? 0).toFixed(2).padStart(9)}  ${m.merchant}${c}`);
      }
      break;
    }
    case "resolve": {
      const { resolved, created } = await resolveProducts(DEFAULT_USER_ID, { force: flags.has("--force") });
      console.log(`Resolved ${resolved} items (${created} new products).`);
      break;
    }
    default:
      usage();
  }
}

function usage(hint?: string) {
  if (hint) console.error(`usage: receiptly ${hint}\n`);
  console.log(`receiptly — item-level receipts from any merchant

  init                  set up the local database + seed connectors
  link                  open the Plaid Link UI to connect a bank
  sync                  pull new transactions from Plaid
  scrape                fetch missing receipts for merchants in your transactions
  scrape <merchant…>    fetch a specific merchant (signs you in automatically)
  login <merchant>      pre-authenticate a merchant (optional)
  discover <merchant>   capture a merchant's traffic to build a connector
  merchants             list connectors + session status
  tx                    show transactions grouped by merchant
  resolve [--force]     (re)resolve items into canonical products`);
}

await main();
