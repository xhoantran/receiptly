import { listConnectors, connectorStats, coverageStats, money, merchantSummary, emojiFor, chipFor, DEFAULT_USER_ID } from "@/lib/data";
import { Card, MerchantBadge, Pill } from "@/components/ui";

export default async function ConnectorsPage() {
  const [connectors, stats, coverage, merchants] = await Promise.all([
    listConnectors(DEFAULT_USER_ID),
    connectorStats(DEFAULT_USER_ID),
    coverageStats(DEFAULT_USER_ID),
    merchantSummary(DEFAULT_USER_ID),
  ]);

  const covByKey = new Map(coverage.map((c) => [c.connectorKey, c]));
  const statsByKey = new Map(stats.map((s) => [s.connectorKey, s]));
  const spendByKey = new Map<string, number>();
  for (const m of merchants) if (m.connectorKey) {
    spendByKey.set(m.connectorKey, (spendByKey.get(m.connectorKey) ?? 0) + (m.total ?? 0));
  }

  // Live (has receipts) first, then coming-soon stubs.
  const ranked = [...connectors].sort(
    (a, b) => (statsByKey.get(b.key)?.receipts ?? 0) - (statsByKey.get(a.key)?.receipts ?? 0)
  );
  const liveCount = ranked.filter((c) => (statsByKey.get(c.key)?.receipts ?? 0) > 0).length;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="rise mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Merchants 🔌</h1>
        <p className="mt-1 text-[14px] text-muted">
          {liveCount} live · {connectors.length} connectors. Each one fetches your itemized receipts —
          some via official APIs, most by working around the long tail.
        </p>
      </header>

      <div className="rise grid gap-4 sm:grid-cols-2">
        {ranked.map((c) => {
          const cov = covByKey.get(c.key);
          const st = statsByKey.get(c.key);
          const live = (st?.receipts ?? 0) > 0;
          const pct = cov && cov.transactions ? Math.round((cov.matched / cov.transactions) * 100) : 0;
          return (
            <Card key={c.key} className={`p-5 ${live ? "" : "opacity-75"}`}>
              <div className="flex items-center gap-3">
                <MerchantBadge chip={chipFor(c.displayName)} emoji={emojiFor(c.key)} size={48} />
                <div className="flex-1">
                  <p className="font-display text-lg font-semibold text-ink">{c.displayName}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {c.mode === "browser" ? (
                      <Pill tone="ink">🛠 workaround</Pill>
                    ) : (
                      <Pill tone="sprout">✓ official</Pill>
                    )}
                    {live ? <Pill tone="sprout">🟢 live</Pill> : <Pill tone="muted">soon</Pill>}
                  </div>
                </div>
              </div>

              {live ? (
                <>
                  <div className="mt-4 flex items-center justify-between rounded-2xl bg-cream/60 px-4 py-3">
                    <div>
                      <p className="text-[12px] text-muted">Receipts · items</p>
                      <p className="amount text-[14px] font-semibold text-ink">
                        {st!.receipts} · {st!.items}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[12px] text-muted">Matched to charges</p>
                      <p className="amount text-[14px] font-semibold text-ink">
                        {cov ? `${cov.matched}/${cov.transactions} · ${pct}%` : "—"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-pill bg-line">
                    <div className="h-full rounded-pill bg-sprout" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="amount mt-3 text-[13px] text-muted">
                    {money(spendByKey.get(c.key) ?? 0)} tracked spend
                  </p>
                </>
              ) : (
                <p className="mt-4 rounded-2xl bg-cream/60 px-4 py-3 text-[13px] leading-snug text-muted">
                  Connector scaffolded. Run{" "}
                  <code className="rounded bg-paper px-1 py-0.5 font-mono text-[12px]">npm run discover {c.key}</code>{" "}
                  to bring it live.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="rise mt-6 border-dashed p-6 text-center">
        <p className="font-display text-lg font-semibold text-ink">Want another merchant? 🌱</p>
        <p className="mx-auto mt-1 max-w-md text-[14px] leading-snug text-muted">
          Run <code className="rounded bg-cream px-1.5 py-0.5 font-mono text-[13px]">npm run discover &lt;merchant&gt;</code>,
          browse the site once, and receiptly learns its receipt API. Contributions welcome.
        </p>
      </Card>
    </div>
  );
}
