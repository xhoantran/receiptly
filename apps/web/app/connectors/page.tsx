import { listConnectors, connectorStats, coverageStats, money, merchantSummary, DEFAULT_USER_ID } from "@/lib/data";
import { Card, Pill } from "@/components/ui";
import { ConnectMerchant } from "@/components/ConnectMerchant";
import { MerchantLogo } from "@/components/MerchantLogo";
import { merchantByKey, merchantsByStatus } from "@/lib/merchants";

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
  const roadmap = merchantsByStatus.filter((m) => m.status === "soon");

  return (
    <div className="mx-auto max-w-3xl">
      <header className="rise mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Merchants 🔌</h1>
        <p className="mt-1 text-[14px] text-muted">
          {liveCount} live · {connectors.length} connected · {roadmap.length} on the roadmap. Each
          merchant fetches your itemized receipts — signed in on your own device, so it just works.
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
                <MerchantLogo
                  domain={merchantByKey[c.key]?.domain}
                  name={c.displayName}
                  color={merchantByKey[c.key]?.color}
                  size={48}
                />
                <div className="flex-1">
                  <p className="font-display text-lg font-semibold text-ink">{c.displayName}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {c.mode === "browser" ? (
                      <Pill tone="ink">🛠 workaround</Pill>
                    ) : (
                      <Pill tone="sprout">✓ official</Pill>
                    )}
                    {live ? <Pill tone="sprout">🟢 live</Pill> : c.mode === "browser" ? null : <Pill tone="muted">soon</Pill>}
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
                  {c.mode === "browser"
                    ? "No receipts yet — connect below to fetch your itemized receipts."
                    : "Official connector — receipts appear once it's enabled."}
                </p>
              )}

              {c.mode === "browser" && (
                <ConnectMerchant
                  connectorKey={c.key}
                  displayName={c.displayName}
                  status={c.status}
                  lastSyncAt={c.lastSyncAt}
                  lastError={c.lastError}
                />
              )}
            </Card>
          );
        })}
      </div>

      <section className="rise mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl font-semibold text-ink">On the roadmap</h2>
          <span className="text-[13px] text-muted">{roadmap.length} more 🌱</span>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {roadmap.map((m) => (
            <Card key={m.key} className="flex flex-col items-center gap-2 p-4 text-center">
              <MerchantLogo domain={m.domain} name={m.name} color={m.color} size={40} />
              <p className="w-full truncate text-[12px] font-semibold text-ink">{m.name}</p>
              <span className="text-[11px] text-muted">{m.category}</span>
            </Card>
          ))}
        </div>
        <p className="mx-auto mt-4 max-w-md text-center text-[13px] leading-snug text-muted">
          Adding a merchant is one entry in the catalog + a connector. Want one bumped up the list? Tell us.
        </p>
      </section>
    </div>
  );
}
