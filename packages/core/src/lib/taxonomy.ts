/**
 * Fixed, merchant-agnostic category taxonomy. Every canonical product is
 * classified into exactly one leaf. Keeping it small + stable makes
 * cross-merchant roll-ups meaningful (and keeps the LLM's choices consistent).
 */
export const TAXONOMY = {
  "Groceries": [
    "Produce",
    "Dairy & Alternatives",
    "Meat & Seafood",
    "Bakery",
    "Pantry & Dry Goods",
    "Snacks & Candy",
    "Beverages",
    "Frozen",
    "Deli & Prepared",
  ],
  "Household": ["Cleaning", "Paper & Disposables", "Kitchen", "Home & Decor", "Tools & Hardware"],
  "Personal Care": ["Skincare", "Hair & Body", "Health & Wellness", "Cosmetics"],
  "Baby & Kids": ["Baby Care", "Toys & Games", "Party Supplies"],
  "Pets": ["Pet Food", "Pet Supplies"],
  "Electronics": ["Devices", "Accessories"],
  "Apparel": ["Clothing", "Shoes & Accessories"],
  "Other": ["Uncategorized"],
} as const;

export type CategoryGroup = keyof typeof TAXONOMY;

/** Flat "Group › Leaf" labels — what we store and what the LLM picks from. */
export const CATEGORY_LABELS: string[] = Object.entries(TAXONOMY).flatMap(([group, leaves]) =>
  leaves.map((leaf) => `${group} › ${leaf}`)
);

export function groupOf(category: string): string {
  return category.split("›")[0]?.trim() ?? "Other";
}
