import Link from "next/link";
import { listTransactions, money, longDate, chipFor, emojiFor, DEFAULT_USER_ID } from "@/lib/data";
import { Card, MerchantBadge } from "@/components/ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Tx = Awaited<ReturnType<typeof listTransactions>>[number];

const pad = (n: number) => String(n).padStart(2, "0");
const parseYm = (s?: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? "");
  return m ? { y: Number(m[1]), mo: Number(m[2]) - 1 } : null;
};
const ymStr = (y: number, mo: number) => `${y}-${pad(mo + 1)}`;
const shiftMonth = (y: number, mo: number, d: number) => {
  const t = new Date(y, mo + d, 1);
  return { y: t.getFullYear(), mo: t.getMonth() };
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const addDays = (iso: string, d: number) => {
  const t = new Date(iso + "T00:00:00");
  t.setDate(t.getDate() + d);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

type Recurring = { merchant: string; connectorKey: string | null; amount: number; cadence: string; nextDate: string };
function detectRecurring(txs: Tx[]): Recurring[] {
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    const k = t.merchant.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || t.merchant;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  const out: Recurring[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    const g = median(gaps);
    const amts = sorted.map((s) => Math.abs(s.amount));
    const avg = amts.reduce((a, b) => a + b, 0) / amts.length;
    const steady = avg > 0 && (Math.max(...amts) - Math.min(...amts)) / avg < 0.25;
    const cadence = g >= 26 && g <= 35 ? "monthly" : g >= 6 && g <= 8 ? "weekly" : g >= 13 && g <= 16 ? "biweekly" : g >= 350 && g <= 380 ? "yearly" : null;
    if (!cadence || !steady) continue;
    const last = sorted[sorted.length - 1];
    out.push({ merchant: last.merchant, connectorKey: last.connectorKey, amount: avg, cadence, nextDate: addDays(last.date, Math.round(g)) });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const latest = await listTransactions(DEFAULT_USER_ID, { limit: 1 });
  const fallback = latest[0]
    ? { y: Number(latest[0].date.slice(0, 4)), mo: Number(latest[0].date.slice(5, 7)) - 1 }
    : { y: new Date().getFullYear(), mo: new Date().getMonth() };
  const { y, mo } = parseYm(m) ?? fallback;

  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const firstWeekday = new Date(y, mo, 1).getDay();
  const monthStart = `${y}-${pad(mo + 1)}-01`;
  const monthEnd = `${y}-${pad(mo + 1)}-${pad(daysInMonth)}`;
  const label = new Date(y, mo, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const monthAbbr = new Date(y, mo, 1).toLocaleDateString("en-US", { month: "short" });
  const prev = shiftMonth(y, mo, -1);
  const next = shiftMonth(y, mo, 1);

  const [txs, wide] = await Promise.all([
    listTransactions(DEFAULT_USER_ID, { from: monthStart, to: monthEnd, limit: 1000 }),
    listTransactions(DEFAULT_USER_ID, { from: addDays(monthStart, -220), to: monthEnd, limit: 3000 }),
  ]);

  // Day totals + the merchants on each day.
  const byDay = new Map<number, Tx[]>();
  for (const t of txs) (byDay.get(Number(t.date.slice(8, 10))) ?? byDay.set(Number(t.date.slice(8, 10)), []).get(Number(t.date.slice(8, 10)))!).push(t);
  const dayTotal = (d: number) => (byDay.get(d) ?? []).reduce((s, t) => s + Math.max(0, t.amount), 0);
  const maxDay = Math.max(1, ...Array.from({ length: daysInMonth }, (_, i) => dayTotal(i + 1)));
  const monthTotal = txs.reduce((s, t) => s + Math.max(0, t.amount), 0);
  const busiest = Array.from({ length: daysInMonth }, (_, i) => i + 1).sort((a, b) => dayTotal(b) - dayTotal(a))[0];

  // Monthly buckets for the sparkline + delta vs previous month.
  const buckets = new Map<string, number>();
  for (const t of wide) {
    const k = t.date.slice(0, 7);
    if (t.amount > 0) buckets.set(k, (buckets.get(k) ?? 0) + t.amount);
  }
  const spark = Array.from({ length: 7 }, (_, i) => {
    const s = shiftMonth(y, mo, -(6 - i));
    return { key: ymStr(s.y, s.mo), v: buckets.get(ymStr(s.y, s.mo)) ?? 0 };
  });
  const sparkMax = Math.max(1, ...spark.map((s) => s.v));
  const lastMonth = buckets.get(ymStr(prev.y, prev.mo)) ?? 0;
  const delta = lastMonth > 0 ? Math.round(((monthTotal - lastMonth) / lastMonth) * 100) : null;

  // Top merchants this month.
  const byMerchant = new Map<string, { spend: number; connectorKey: string | null; name: string }>();
  for (const t of txs) {
    if (t.amount <= 0) continue;
    const e = byMerchant.get(t.merchant) ?? { spend: 0, connectorKey: t.connectorKey, name: t.merchant };
    e.spend += t.amount;
    byMerchant.set(t.merchant, e);
  }
  const topMerchants = [...byMerchant.values()].sort((a, b) => b.spend - a.spend).slice(0, 5);
  const topMax = Math.max(1, ...topMerchants.map((mm) => mm.spend));

  // Recurring → upcoming, and a map of predicted charges falling in this month.
  const recurring = detectRecurring(wide);
  const todayIso = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`;
  const upcoming = recurring.filter((r) => r.nextDate >= monthStart).slice(0, 5);
  const predictedByDay = new Map<number, Recurring>();
  for (const r of recurring) {
    if (r.nextDate >= monthStart && r.nextDate <= monthEnd && r.nextDate > todayIso) {
      const d = Number(r.nextDate.slice(8, 10));
      if (!predictedByDay.has(d) && !byDay.has(d)) predictedByDay.set(d, r);
    }
  }
  const recurringMonthly = recurring.reduce((s, r) => s + r.amount * (r.cadence === "weekly" ? 4.33 : r.cadence === "biweekly" ? 2.17 : r.cadence === "yearly" ? 1 / 12 : 1), 0);

  const today = new Date();
  const todayD = today.getFullYear() === y && today.getMonth() === mo ? today.getDate() : -1;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="mx-auto max-w-5xl">
      <header className="rise mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Calendar 📅</h1>
          <p className="mt-1 text-[14px] text-muted">
            You spent <b className="font-semibold text-sprout-deep">{money(monthTotal)}</b> in {monthAbbr}
            {recurringMonthly > 0 && <> · <b className="font-semibold text-sprout-deep">{money(recurringMonthly)}/mo</b> recurring</>}
            {dayTotal(busiest) > 0 && <> · busiest day was the {busiest}{ordinal(busiest)}</>}
          </p>
        </div>
        <nav className="flex items-center gap-1.5">
          <Link href={`/calendar?m=${ymStr(prev.y, prev.mo)}`} aria-label="Previous month" className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink-soft shadow-soft transition hover:bg-cream">←</Link>
          <span className="min-w-[150px] text-center font-display text-lg font-semibold text-ink">{label}</span>
          <Link href={`/calendar?m=${ymStr(next.y, next.mo)}`} aria-label="Next month" className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink-soft shadow-soft transition hover:bg-cream">→</Link>
        </nav>
      </header>

      {/* Calendar */}
      <Card className="rise p-3 sm:p-4">
          <div className="mb-1.5 grid grid-cols-7">
            {WEEKDAYS.map((w) => (
              <div key={w} className="pb-1 text-center text-[10.5px] font-bold uppercase tracking-wider text-muted">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((d, i) => {
              if (d === null) return <div key={`b${i}`} className="min-h-[84px]" />;
              const list = byDay.get(d) ?? [];
              const total = dayTotal(d);
              const isToday = d === todayD;
              const predicted = predictedByDay.get(d);
              const seen = new Set<string>();
              const marks = list.filter((t) => {
                const k = t.connectorKey ?? t.merchant;
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
              });
              return (
                <div
                  key={d}
                  className={`flex min-h-[84px] flex-col rounded-2xl border bg-surface p-2 transition hover:-translate-y-px hover:shadow-pop ${
                    isToday ? "border-sprout ring-1 ring-sprout/40" : "border-line/70"
                  } ${predicted ? "border-dashed" : ""}`}
                  style={{ background: total > 0 ? `rgba(15,169,104,${0.07 + 0.5 * (total / maxDay)})` : undefined }}
                >
                  <span className={`text-[11px] font-bold ${isToday ? "text-sprout-deep" : "text-ink-soft"}`}>
                    {d}{isToday ? " · Today" : ""}
                  </span>
                  {total > 0 ? (
                    <>
                      <span className="amount mt-0.5 text-[12.5px] font-semibold leading-none text-ink">{money(total)}</span>
                      <div className="mt-1 h-1 rounded-full bg-sprout" style={{ width: `${Math.max(16, Math.round((total / maxDay) * 100))}%`, opacity: 0.45 + 0.5 * (total / maxDay) }} />
                      <div className="mt-auto flex flex-wrap items-center gap-0.5 pt-1.5">
                        {marks.slice(0, 3).map((t) => (
                          <MerchantBadge key={t.id} chip={chipFor(t.merchant)} emoji={emojiFor(t.merchant)} connectorKey={t.connectorKey} size={17} />
                        ))}
                        {marks.length > 3 && <span className="self-end text-[10px] text-muted">+{marks.length - 3}</span>}
                      </div>
                      {d === busiest && <span className="mt-1 self-start rounded-pill bg-sprout-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sprout-deep">busiest</span>}
                    </>
                  ) : predicted ? (
                    <div className="mt-auto">
                      <div className="flex items-center gap-1 text-[11px] text-ink-soft">
                        <MerchantBadge chip={chipFor(predicted.merchant)} emoji={emojiFor(predicted.merchant)} connectorKey={predicted.connectorKey} size={15} />
                        <span className="truncate">{predicted.merchant}</span>
                      </div>
                      <span className="mt-1 inline-block rounded-pill bg-butter/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-clay">renews</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>

      {/* Insights */}
      <section className="rise mt-5 grid items-start gap-4 md:grid-cols-3" style={{ animationDelay: "60ms" }}>
          <Card className="p-4">
            <h3 className="font-display text-[15px] font-semibold text-ink">This month</h3>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="amount text-3xl font-semibold tracking-tight text-ink">{money(monthTotal)}</span>
              {delta !== null && (
                <span className={`text-[12.5px] font-semibold ${delta > 0 ? "text-berry" : "text-sprout-deep"}`}>
                  {delta > 0 ? "↑" : "↓"} {Math.abs(delta)}% vs {new Date(prev.y, prev.mo, 1).toLocaleDateString("en-US", { month: "short" })}
                </span>
              )}
            </div>
            <div className="mt-4 flex h-12 items-end gap-1.5">
              {spark.map((s, i) => (
                <div key={s.key} className={`flex-1 rounded-t-md ${i === 6 ? "bg-sprout" : "bg-sprout-soft"}`} style={{ height: `${Math.max(8, Math.round((s.v / sparkMax) * 100))}%` }} title={`${s.key}: ${money(s.v)}`} />
              ))}
            </div>
          </Card>

          {topMerchants.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-3 font-display text-[15px] font-semibold text-ink">Where it went</h3>
              <div className="space-y-2.5">
                {topMerchants.map((mm) => (
                  <div key={mm.name} className="flex items-center gap-2.5">
                    <MerchantBadge chip={chipFor(mm.name)} emoji={emojiFor(mm.name)} connectorKey={mm.connectorKey} size={22} />
                    <span className="w-20 truncate text-[12.5px] text-ink-soft">{mm.name}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-pill bg-cream">
                      <span className="block h-full rounded-pill bg-sprout" style={{ width: `${Math.round((mm.spend / topMax) * 100)}%` }} />
                    </span>
                    <span className="amount min-w-[52px] text-right text-[12px] text-ink">{money(mm.spend)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-display text-[15px] font-semibold text-ink">Upcoming</h3>
              <span className="rounded-pill bg-butter/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-clay">predicted</span>
            </div>
            {upcoming.length === 0 ? (
              <p className="py-3 text-center text-[13px] text-muted">No recurring charges detected yet.</p>
            ) : (
              <div className="divide-y divide-line/70">
                {upcoming.map((r) => (
                  <div key={r.merchant + r.nextDate} className="flex items-center gap-3 py-2.5">
                    <MerchantBadge chip={chipFor(r.merchant)} emoji={emojiFor(r.merchant)} connectorKey={r.connectorKey} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-ink">{r.merchant}</p>
                      <p className="text-[12px] text-muted">{longDate(r.nextDate)} · {r.cadence}</p>
                    </div>
                    <span className="amount text-[14px] font-semibold text-ink">{money(r.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
      </section>
    </div>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
