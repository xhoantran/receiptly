import type { Page } from "playwright";
import type { Tx } from "../lib/plaid.js";
import type { ExtractedReceipt } from "../lib/extract.js";

export type ConnectorMode = "api" | "browser";

/** A connector receives an already-authenticated page; the session layer handles login. */
export type FetchContext = { page: Page };

export type Connector = {
  key: string;
  displayName: string;
  /**
   * "api"     — officially supported: public/documented API, OAuth, or email parsing
   * "browser" — workaround: reverse-engineered via Playwright. Our core target.
   */
  mode: ConnectorMode;
  matches: (tx: Tx) => boolean;
  /** Where login + scraping start. The session opens here. */
  loginUrl: string;
  /** Lightweight check (usually URL-based) that the page is in a signed-in state. */
  isLoggedIn: (page: Page) => Promise<boolean>;
  /** Fetch receipts using the authenticated page from ctx. No login here. */
  fetchReceipts: (ctx: FetchContext) => Promise<ExtractedReceipt[]>;
};

export type ConnectorRunResult = {
  connector: string;
  receipts: ExtractedReceipt[];
  error?: string;
};

export { type Tx, type ExtractedReceipt };
