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
    throw new Error(
      "costco connector not implemented yet. Run `receiptly discover costco` to capture its API, then implement fetchReceipts."
    );
  },
};
