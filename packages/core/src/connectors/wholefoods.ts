import type { Connector, Tx } from "./types.js";

// Whole Foods purchases live in the buyer's AMAZON account (Amazon owns WFM), so
// capture rides the on-device Amazon flow: the WFM scraper opens Amazon's order
// history (shared login) and keeps the Whole Foods orders. No server-side path.
export const wholefoodsConnector: Connector = {
  key: "wholefoods",
  displayName: "Whole Foods",
  mode: "browser",
  loginUrl: "https://www.amazon.com/your-orders/orders",

  matches(tx: Tx) {
    return /whole\s?foods|wholefds/i.test(`${tx.merchant} ${tx.raw_name}`);
  },

  async isLoggedIn(page) {
    const u = page.url();
    return u.includes("/your-orders") && !u.includes("/ap/signin");
  },

  async fetchReceipts() {
    throw new Error(
      "Whole Foods receipts are captured on your device (via Amazon) — open the receiptly desktop app to connect."
    );
  },
};
