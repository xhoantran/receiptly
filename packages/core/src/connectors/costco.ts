import type { Connector, Tx } from "./types.js";

export const costcoConnector: Connector = {
  key: "costco",
  displayName: "Costco",
  mode: "browser",
  loginUrl: "https://www.costco.com/OrdersAndPurchases",

  matches(tx: Tx) {
    return /costco/i.test(`${tx.merchant} ${tx.raw_name}`);
  },

  async isLoggedIn(page) {
    return /OrdersAndPurchases|orderhistory/i.test(page.url()) && !/logon|signin/i.test(page.url());
  },

  async fetchReceipts() {
    // Costco has no server-side scrape path — its receipts are captured on-device.
    throw new Error("Costco receipts are captured on your device — open the receiptly desktop app to connect.");
  },
};
