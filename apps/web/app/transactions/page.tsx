import Link from "next/link";
import { listTransactions, money, shortDate, chipFor, emojiFor, DEFAULT_USER_ID } from "@/lib/data";
import { Card, MerchantBadge, Pill } from "@/components/ui";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string }>;
}) {
  const { merchant } = await searchParams;
  const txs = await listTransactions(DEFAULT_USER_ID, { merchant, limit: 200 });

  // group by month
  const groups = new Map<string, typeof txs>();
  for (const t of txs) {
    const key = t.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="rise mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            {merchant ?? "All transactions"}
          </h1>
          <p className="mt-1 text-[14px] text-muted">{txs.length} transactions</p>
        </div>
        {merchant && (
          <Link href="/transactions" className="text-[14px] font-semibold text-sprout-deep hover:underline">
            ← Clear filter
          </Link>
        )}
      </header>

      <div className="space-y-6">
        {[...groups.entries()].map(([month, list]) => (
          <section key={month} className="rise">
            <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">
              {new Date(month + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </h2>
            <Card className="divide-y divide-line/70 overflow-hidden">
              {list.map((t) => (
                <Link
                  key={t.id}
                  href={`/transactions/${t.id}`}
                  className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-cream/40"
                >
                  <MerchantBadge chip={chipFor(t.merchant)} emoji={emojiFor(t.merchant)} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-ink">{t.merchant}</p>
                    <p className="text-[13px] text-muted">
                      {shortDate(t.date)}
                      {t.pending && " · pending"}
                    </p>
                  </div>
                  {t.connectorKey && <Pill tone="sprout">🧾</Pill>}
                  <span className="amount text-[15px] font-semibold text-ink">{money(t.amount)}</span>
                </Link>
              ))}
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
