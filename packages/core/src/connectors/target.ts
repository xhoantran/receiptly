import type { Connector, Tx } from "./types.js";

// Captured on-device (generic order scraper). No server-side path.
export const targetConnector: Connector = {
  key: "target",
  displayName: "Target",
  mode: "browser",
  loginUrl: "https://www.target.com/orders",

  matches(tx: Tx) {
    return /\btarget\b/i.test(`${tx.merchant} ${tx.raw_name}`);
  },

  async isLoggedIn(page) {
    return /target\.com\/(orders|account)/i.test(page.url()) && !/login|signin/i.test(page.url());
  },

  async fetchReceipts() {
    throw new Error("Target receipts are captured on your device — open the receiptly desktop app to connect.");
  },
};
