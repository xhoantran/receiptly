import Link from "next/link";
import {
  listTransactions,
  merchantSummary,
  coverageStats,
  spendingByItem,
  savingsSummary,
  money,
  shortDate,
  chipFor,
  emojiFor,
} from "@/lib/data";
import { Card, MerchantBadge, Pill } from "@/components/ui";

export default async function Dashboard() {
  const [txs, merchants, coverage, items, savings] = await Promise.all([
    listTransactions({ limit: 8 }),
    merchantSummary(),
    coverageStats(),
    spendingByItem(),
    savingsSummary(),
  ]);

  const totalSpend = merchants.reduce((s, m) => s + Math.max(0, m.total ?? 0), 0);
  const itemsTracked = items.length;
  const matched = coverage.reduce((s, c) => s + c.matched, 0);
  const connectorTx = coverage.reduce((s, c) => s + c.transactions, 0);
  const coveragePct = connectorTx ? Math.round((matched / connectorTx) * 100) : 0;

  const topMerchants = merchants.filter((m) => m.connectorKey).slice(0, 4);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="rise mb-8">
        <p className="text-[15px] font-medium text-muted">Welcome back 👋</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
          Here&apos;s what you&apos;ve been buying
        </h1>
      </header>

      {/* Stat tiles */}
      <section className="rise mb-8 grid grid-cols-2 gap-4 md:grid-cols-4" style={{ animationDelay: "60ms" }}>
        <Stat label="Total spend" value={money(totalSpend)} bg="bg-sky" />
        <Stat label="Saved with deals" value={money(savings.totalSaved)} bg="bg-sprout-soft" accent />
        <Stat label="Items tracked" value={String(itemsTracked)} bg="bg-butter" />
        <Stat label="Receipt match" value={`${coveragePct}%`} bg="bg-pink" />
      </section>

      {/* Top merchants */}
      <section className="rise mb-8" style={{ animationDelay: "120ms" }}>
        <h2 className="mb-3 font-display text-xl font-semibold text-ink">Top merchants</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {topMerchants.map((m) => (
            <Link key={m.merchant} href={`/transactions?merchant=${encodeURIComponent(m.merchant)}`}>
              <Card className="flex flex-col gap-3 p-4 transition-transform hover:-translate-y-0.5 hover:shadow-pop">
                <MerchantBadge chip={chipFor(m.merchant)} emoji={emojiFor(m.merchant)} />
                <div>
                  <p className="truncate text-[14px] font-semibold text-ink">{m.merchant}</p>
                  <p className="amount mt-0.5 text-[13px] text-muted">{money(m.total)}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent transactions */}
      <section className="rise" style={{ animationDelay: "180ms" }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-ink">Recent activity</h2>
          <Link href="/transactions" className="text-[14px] font-semibold text-sprout-deep hover:underline">
            See all →
          </Link>
        </div>
        <Card className="divide-y divide-line/70 overflow-hidden">
          {txs.map((t) => (
            <Link
              key={t.id}
              href={`/transactions/${t.id}`}
              className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-cream/40"
            >
              <MerchantBadge chip={chipFor(t.merchant)} emoji={emojiFor(t.merchant)} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-ink">{t.merchant}</p>
                <p className="text-[13px] text-muted">{shortDate(t.date)}</p>
              </div>
              {t.connectorKey && <Pill tone="sprout">🧾 receipt</Pill>}
              <span className="amount text-[15px] font-semibold text-ink">{money(t.amount)}</span>
            </Link>
          ))}
        </Card>
      </section>
    </div>
  );
}

function Stat({ label, value, bg, accent }: { label: string; value: string; bg: string; accent?: boolean }) {
  return (
    <Card className={`p-4 ${accent ? "ring-1 ring-sprout/30" : ""}`}>
      <span className={`mb-3 inline-block h-9 w-9 rounded-2xl ${bg}`} />
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={`amount mt-0.5 text-2xl font-semibold ${accent ? "text-sprout-deep" : "text-ink"}`}>{value}</p>
    </Card>
  );
}
