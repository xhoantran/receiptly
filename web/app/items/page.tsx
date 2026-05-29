import {
  spendingByCategory,
  canonicalProducts,
  money,
  categoryGroup,
  categoryLeaf,
  chipForCategory,
} from "@/lib/data";
import { Card } from "@/components/ui";
import { ItemImage } from "@/components/ItemImage";

const CHIP_BG: Record<string, string> = {
  pink: "bg-pink", lilac: "bg-lilac", butter: "bg-butter", sky: "bg-sky",
  peach: "bg-peach", mint: "bg-mint", clay: "bg-clay",
};

export default async function ItemsPage() {
  const [categories, productsList] = await Promise.all([spendingByCategory(), canonicalProducts()]);
  const totalSpent = categories.reduce((s, c) => s + (c.totalSpent ?? 0), 0);
  const maxSpent = Math.max(1, ...productsList.map((p) => p.totalSpent ?? 0));

  return (
    <div className="mx-auto max-w-3xl">
      <header className="rise mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Things I buy 🥑</h1>
        <p className="mt-1 text-[14px] text-muted">
          {productsList.length} products across {categories.length} categories — unified across every merchant.
        </p>
      </header>

      {/* Category breakdown — cross-merchant */}
      <section className="rise mb-8">
        <div className="mb-3 flex h-3 overflow-hidden rounded-pill">
          {categories.map((c) => {
            const pct = ((c.totalSpent ?? 0) / totalSpent) * 100;
            const chip = chipForCategory(c.category);
            return <span key={c.category} className={CHIP_BG[chip]} style={{ width: `${pct}%` }} title={c.category} />;
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {categories.slice(0, 9).map((c) => {
            const chip = chipForCategory(c.category);
            return (
              <div key={c.category} className="flex items-center gap-2 rounded-2xl border border-line/70 bg-surface px-3 py-2">
                <span className={`h-3 w-3 shrink-0 rounded-full ${CHIP_BG[chip]}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-ink">{categoryLeaf(c.category)}</p>
                  <p className="text-[11px] text-muted">{categoryGroup(c.category)}</p>
                </div>
                <span className="amount text-[12px] font-semibold text-ink">{money(c.totalSpent)}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Canonical products */}
      <Card className="rise divide-y divide-line/70 overflow-hidden">
        {productsList.map((p) => {
          const pct = Math.round(((p.totalSpent ?? 0) / maxSpent) * 100);
          const spread = (p.maxUnit ?? 0) - (p.minUnit ?? 0);
          return (
            <div key={p.id} className="relative px-4 py-3.5">
              <div className="absolute inset-y-0 left-0 bg-sprout-soft/30" style={{ width: `${pct}%` }} aria-hidden />
              <div className="relative flex items-center gap-3.5">
                <ItemImage src={p.imageUrl} name={p.name} size={42} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{p.name}</p>
                  <p className="text-[12px] text-muted">
                    {p.brand ? `${p.brand} · ` : ""}
                    {p.timesBought}× · {categoryLeaf(p.category)}
                    {p.merchants > 1 && <span className="text-sprout-deep"> · {p.merchants} stores</span>}
                  </p>
                </div>
                <div className="text-right">
                  <p className="amount text-[15px] font-semibold text-ink">{money(p.totalSpent)}</p>
                  {spread > 0.01 && (
                    <p className="amount text-[11px] text-muted">
                      {money(p.minUnit)}–{money(p.maxUnit)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {productsList.length === 0 && (
          <p className="px-4 py-10 text-center text-[14px] text-muted">
            No products yet. Run a connector, then <code className="font-mono">npm run resolve</code>.
          </p>
        )}
      </Card>
    </div>
  );
}
