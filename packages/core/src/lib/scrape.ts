/**
 * Headless scrape — restore a user's saved merchant session, run the
 * connector's `fetchReceipts` against the authenticated page, and ingest the
 * results. This is what the pg-boss "scrape" worker calls after a successful
 * interactive login (and what a scheduled re-sync would call).
 *
 * WebKit ONLY, headless (see lib/browser/provider.ts). Playwright lives here —
 * this module MUST NOT be imported by apps/web; the web app reaches scraping
 * only through the worker over HTTP/WS.
 */
import { connectorsByKey } from "../connectors/index.js";
import {
  getMerchantSession,
  setMerchantConnectionStatus,
} from "../db/repo.js";
import { ingest } from "./ingest.js";
import { browserProvider, DEFAULT_VIEWPORT } from "./browser/provider.js";

export type ScrapeResult = {
  receipts: number;
  matched: number;
  total: number;
  resolved: number;
  products: number;
};

const ZERO: ScrapeResult = { receipts: 0, matched: 0, total: 0, resolved: 0, products: 0 };

export async function runScrape(
  userId: string,
  connectorKey: string
): Promise<ScrapeResult> {
  const connector = connectorsByKey[connectorKey];
  if (!connector) throw new Error(`Unknown connector: ${connectorKey}`);

  const state = await getMerchantSession(userId, connectorKey);
  if (state === null) {
    await setMerchantConnectionStatus(userId, connectorKey, "error", {
      lastError: "Not signed in — connect this merchant first.",
    });
    return ZERO;
  }

  const { browser, page } = await browserProvider.openContext({
    storageState: state,
    viewport: DEFAULT_VIEWPORT,
    headless: true,
  });

  try {
    const receipts = await connector.fetchReceipts({ page });
    const result = await ingest(userId, connectorKey, receipts);
    await setMerchantConnectionStatus(userId, connectorKey, "linked", {
      lastSyncAt: Date.now(),
      lastError: null,
    });
    return result;
  } catch (err) {
    await setMerchantConnectionStatus(userId, connectorKey, "error", {
      lastError: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}
