// The receiptly backend = the Next web app (`pnpm web`). Your phone must be on the
// SAME Wi-Fi as this Mac. If the Mac's LAN IP changes, update this.
export const API_URL = "http://192.168.1.150:4000";

// Publix "your purchases" page — redirects to the Azure B2C login when signed out.
export const PUBLIX_URL =
  "https://www.publix.com/account/purchases?nav=account_sidebar_button";

/** Build the in-store receipt detail page URL (the page then fetches the detail API). */
export function publixDetailUrl(store: string, item: { PurchaseDate: string; Id: string }): string {
  return (
    "https://www.publix.com/account/purchases/purchase-details" +
    `?storeNumber=${store}` +
    `&purchaseDate=${encodeURIComponent(item.PurchaseDate)}` +
    `&key=${encodeURIComponent(item.Id)}`
  );
}
