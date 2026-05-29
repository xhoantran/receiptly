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
  DEFAULT_USER_ID,
} from "@/lib/data";
import { Card, MerchantBadge, Pill } from "@/components/ui";
import { ConnectBank } from "@/components/ConnectBank";
import { SyncButton } from "@/components/SyncButton";

export default async function Dashboard() {
  const [txs, merchants, coverage, items, savings] = await Promise.all([
    listTransactions(DEFAULT_USER_ID, { limit: 8 }),
    merchantSummary(DEFAULT_USER_ID),
    coverageStats(DEFAULT_USER_ID),
    spendingByItem(DEFAULT_USER_ID),
    savingsSummary(DEFAULT_USER_ID),
  ]);

  const totalSpend = merchants.reduce((s, m) => s + Math.max(0, m.total ?? 0), 0);
  const itemsTracked = items.length;
  const matched = coverage.reduce((s, c) => s + c.matched, 0);
  const connectorTx = coverage.reduce((s, c) => s + c.transactions, 0);
  const coveragePct = connectorTx ? Math.round((matched / connectorTx) * 100) : 0;

  const topMerchants = merchants.filter((m) => m.connectorKey).slice(0, 4);
  const hasData = txs.length > 0 || merchants.length > 0;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="rise mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[15px] font-medium text-muted">Welcome back 👋</p>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
            Here&apos;s what you&apos;ve been buying
          </h1>
        </div>
        {hasData && (
          <div className="flex items-center gap-2">
            <SyncButton />
            <ConnectBank variant="ghost" label="Connect another bank" />
          </div>
        )}
      </header>

      {!hasData ? (
        <Card
          className="rise flex flex-col items-center gap-4 px-6 py-12 text-center"
          style={{ animationDelay: "60ms" }}
        >
          <span className="grid h-16 w-16 place-items-center rounded-3xl bg-sprout-soft text-3xl shadow-inset">
            🏦
          </span>
          <div className="max-w-md">
            <h2 className="font-display text-2xl font-semibold text-ink">
              Connect your bank to get started
            </h2>
            <p className="mt-1.5 text-[15px] text-muted">
              receiptly pulls in your transactions, then fetches the itemized receipt behind each
              charge.
            </p>
          </div>
          <ConnectBank />
        </Card>
      ) : (
        <>
          {/* Stat tiles */}
          <section
            className="rise mb-8 grid grid-cols-2 gap-4 md:grid-cols-4"
            style={{ animationDelay: "60ms" }}
          >
            <Stat label="Total spend" value={money(totalSpend)} bg="bg-sky" />
            <Stat label="Saved with deals" value={money(savings.totalSaved)} bg="bg-sprout-soft" accent />
            <Stat label="Items tracked" value={String(itemsTracked)} bg="bg-butter" />
            <Stat label="Receipt match" value={`${coveragePct}%`} bg="bg-pink" />
          </section>

          {/* Top merchants */}
          {topMerchants.length > 0 && (
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
          )}

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
        </>
      )}
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
