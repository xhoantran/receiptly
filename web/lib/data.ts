import "server-only";

// Bridge to the shared library in ../src. better-sqlite3 is marked external in
// next.config so it loads natively at runtime.
export {
  listTransactions,
  getTransaction,
  merchantSummary,
  listConnectors,
  connectorStats,
  coverageStats,
  spendingByItem,
  spendingByCategory,
  canonicalProducts,
  productPriceByMerchant,
  savingsSummary,
  priceHistory,
  getReceiptWithItems,
  getMatchForTransaction,
  listReceipts,
} from "../../src/db/repo.js";

export type { Connector } from "../../src/connectors/types.js";

// ─── View-model helpers ───

export function money(n: number | null | undefined): string {
  const v = n ?? 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Category group → pastel chip (cross-merchant color coding)
const GROUP_CHIP: Record<string, string> = {
  Groceries: "mint",
  Household: "sky",
  "Personal Care": "lilac",
  "Baby & Kids": "pink",
  Pets: "butter",
  Electronics: "clay",
  Apparel: "peach",
  Other: "clay",
};
export function categoryGroup(category: string): string {
  return category.split("›")[0]?.trim() ?? "Other";
}
export function categoryLeaf(category: string): string {
  return category.split("›")[1]?.trim() ?? category;
}
export function chipForCategory(category: string): string {
  return GROUP_CHIP[categoryGroup(category)] ?? "clay";
}

// "0.5 lb" for weight items, "2×" for counted items
export function qtyLabel(qty: number, unit?: string | null): string {
  if (unit && unit !== "ea") return `${+qty.toFixed(2)} ${unit}`;
  return `${+qty.toFixed(0)}×`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function longDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// Deterministic pastel chip per merchant
const CHIPS = ["pink", "lilac", "butter", "sky", "peach", "mint", "clay"] as const;
export type Chip = (typeof CHIPS)[number];

export function chipFor(name: string): Chip {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CHIPS[h % CHIPS.length];
}

// Emoji per merchant/category — playful identity
const EMOJI: Record<string, string> = {
  publix: "🛒", amazon: "📦", costco: "🏬", starbucks: "☕",
  grab: "🛵", shell: "⛽", wawa: "🌅", "7-eleven": "🏪",
  youtube: "▶️", ikea: "🛋️", "h mart": "🥬", "sam's club": "🏷️",
};
export function emojiFor(merchant: string): string {
  const key = merchant.toLowerCase();
  for (const [k, v] of Object.entries(EMOJI)) if (key.includes(k)) return v;
  return "💳";
}
