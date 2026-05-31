import type { Connector, Tx } from "./types.js";

// Captured on-device (generic order scraper). No server-side path. `matches` covers
// the Kroger family of banners (Ralphs, Fred Meyer, King Soopers, Smith's, …).
export const krogerConnector: Connector = {
  key: "kroger",
  displayName: "Kroger",
  mode: "browser",
  loginUrl: "https://www.kroger.com/mypurchases",

  matches(tx: Tx) {
    return /kroger|ralphs|fred meyer|king soopers|smith'?s|fry'?s food|harris teeter|food 4 less/i.test(
      `${tx.merchant} ${tx.raw_name}`
    );
  },

  async isLoggedIn(page) {
    return /kroger\.com\/(mypurchases|account)/i.test(page.url()) && !/signin|login/i.test(page.url());
  },

  async fetchReceipts() {
    throw new Error("Kroger receipts are captured on your device — open the receiptly desktop app to connect.");
  },
};
