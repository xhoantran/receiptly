import type { Connector, Tx } from "./types.js";

// Captured on-device (generic order scraper). No server-side path.
export const walmartConnector: Connector = {
  key: "walmart",
  displayName: "Walmart",
  mode: "browser",
  loginUrl: "https://www.walmart.com/orders",

  matches(tx: Tx) {
    return /wal[\s-]?mart|wm supercenter/i.test(`${tx.merchant} ${tx.raw_name}`);
  },

  async isLoggedIn(page) {
    return /walmart\.com\/(orders|account)/i.test(page.url()) && !/login|signin/i.test(page.url());
  },

  async fetchReceipts() {
    throw new Error("Walmart receipts are captured on your device — open the receiptly desktop app to connect.");
  },
};
