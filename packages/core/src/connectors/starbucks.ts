import type { Connector, Tx } from "./types.js";

export const starbucksConnector: Connector = {
  key: "starbucks",
  displayName: "Starbucks",
  mode: "browser",
  loginUrl: "https://www.starbucks.com/account/history",

  matches(tx: Tx) {
    return /starbucks/i.test(`${tx.merchant} ${tx.raw_name}`);
  },

  async isLoggedIn(page) {
    return page.url().includes("/account") && !/signin|login/i.test(page.url());
  },

  async fetchReceipts() {
    throw new Error(
      "starbucks connector not implemented yet. Run `receiptly discover starbucks` to capture its API, then implement fetchReceipts."
    );
  },
};
