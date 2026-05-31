// The merchant library — the single source of truth for which merchants receiptly
// supports (and which are on the roadmap), with branding for the UI.
//
// To add support for a merchant: add an entry here (logo comes free from the
// domain), then build its connector + on-device capture. `status`:
//   live    — working end-to-end (capture + ingest)
//   beta    — connector scaffolded, not fully wired
//   soon    — on the roadmap, no connector yet
export type MerchantStatus = "live" | "beta" | "soon";

export type Merchant = {
  key: string; // matches the connector key, e.g. "publix"
  name: string;
  domain: string; // drives the logo (see MerchantLogo)
  color: string; // brand color — the logo fallback chip
  status: MerchantStatus;
  category: "Grocery" | "Retail" | "Pharmacy" | "Wholesale" | "Food" | "Delivery";
};

export const MERCHANTS: Merchant[] = [
  { key: "publix", name: "Publix", domain: "publix.com", color: "#007a3e", status: "live", category: "Grocery" },
  { key: "amazon", name: "Amazon", domain: "amazon.com", color: "#ff9900", status: "beta", category: "Retail" },
  { key: "costco", name: "Costco", domain: "costco.com", color: "#e31837", status: "beta", category: "Wholesale" },
  { key: "starbucks", name: "Starbucks", domain: "starbucks.com", color: "#00704a", status: "soon", category: "Food" },
  { key: "target", name: "Target", domain: "target.com", color: "#cc0000", status: "beta", category: "Retail" },
  { key: "walmart", name: "Walmart", domain: "walmart.com", color: "#0071dc", status: "beta", category: "Retail" },
  { key: "kroger", name: "Kroger", domain: "kroger.com", color: "#0d4d9e", status: "beta", category: "Grocery" },
  { key: "wholefoods", name: "Whole Foods", domain: "wholefoodsmarket.com", color: "#00674b", status: "beta", category: "Grocery" },
  { key: "traderjoes", name: "Trader Joe's", domain: "traderjoes.com", color: "#b4282d", status: "soon", category: "Grocery" },
  { key: "aldi", name: "ALDI", domain: "aldi.us", color: "#00417f", status: "soon", category: "Grocery" },
  { key: "samsclub", name: "Sam's Club", domain: "samsclub.com", color: "#0067a0", status: "soon", category: "Wholesale" },
  { key: "heb", name: "H-E-B", domain: "heb.com", color: "#ed1c24", status: "soon", category: "Grocery" },
  { key: "cvs", name: "CVS", domain: "cvs.com", color: "#cc0000", status: "soon", category: "Pharmacy" },
  { key: "walgreens", name: "Walgreens", domain: "walgreens.com", color: "#e01a2b", status: "soon", category: "Pharmacy" },
  { key: "instacart", name: "Instacart", domain: "instacart.com", color: "#43b02a", status: "soon", category: "Delivery" },
  { key: "doordash", name: "DoorDash", domain: "doordash.com", color: "#ff3008", status: "soon", category: "Delivery" },
  { key: "ubereats", name: "Uber Eats", domain: "ubereats.com", color: "#06c167", status: "soon", category: "Delivery" },
  { key: "chipotle", name: "Chipotle", domain: "chipotle.com", color: "#a81612", status: "soon", category: "Food" },
  { key: "homedepot", name: "The Home Depot", domain: "homedepot.com", color: "#f96302", status: "soon", category: "Retail" },
  { key: "bestbuy", name: "Best Buy", domain: "bestbuy.com", color: "#0046be", status: "soon", category: "Retail" },
];

export const merchantByKey: Record<string, Merchant> = Object.fromEntries(
  MERCHANTS.map((m) => [m.key, m])
);

const ORDER: Record<MerchantStatus, number> = { live: 0, beta: 1, soon: 2 };
export const merchantsByStatus = [...MERCHANTS].sort(
  (a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name)
);

/** Candidate logo URLs for a domain, best-first; MerchantLogo falls through onError.
 * (Clearbit's free logo API was shut down; favicon services return the brand mark
 * and are reliable + token-free. Swap in local SVGs later for pixel-perfect logos.) */
export function logoSources(domain: string): string[] {
  return [
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  ];
}
