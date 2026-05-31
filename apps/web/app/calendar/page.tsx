import Link from "next/link";
import { listTransactions, money, longDate, DEFAULT_USER_ID } from "@/lib/data";
import { Card, MerchantBadge } from "@/components/ui";
import { chipFor, emojiFor } from "@/lib/data";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Tx = Awaited<ReturnType<typeof listTransactions>>[number];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function parseYm(s?: string): { y: number; mo: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? "");
  return m ? { y: Number(m[1]), mo: Number(m[2]) - 1 } : null;
}
function ymStr(y: number, mo: number) {
  return `${y}-${pad(mo + 1)}`;
}
function shiftMonth(y: number, mo: number, d: number) {
  const t = new Date(y, mo + d, 1);
  return { y: t.getFullYear(), mo: t.getMonth() };
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
function addDays(iso: string, d: number) {
  const t = new Date(iso + "T00:00:00");
  t.setDate(t.getDate() + d);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

// Recurring = a merchant charged repeatedly at a regular cadence with a steady
// amount (subscriptions, memberships) — not the variable grocery runs.
type Recurring = { merchant: string; connectorKey: string | null; amount: number; cadence: string; nextDate: string; count: number };
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
    const medGap = median(gaps);
    const amts = sorted.map((s) => Math.abs(s.amount));
    const avg = amts.reduce((a, b) => a + b, 0) / amts.length;
    const steady = avg > 0 && (Math.max(...amts) - Math.min(...amts)) / avg < 0.25;
    let cadence: string | null = null;
    if (medGap >= 26 && medGap <= 35) cadence = "monthly";
    else if (medGap >= 6 && medGap <= 8) cadence = "weekly";
    else if (medGap >= 13 && medGap <= 16) cadence = "biweekly";
    else if (medGap >= 350 && medGap <= 380) cadence = "yearly";
    if (!cadence || !steady) continue;
    const last = sorted[sorted.length - 1];
    out.push({
      merchant: last.merchant,
      connectorKey: last.connectorKey,
      amount: avg,
      cadence,
      nextDate: addDays(last.date, Math.round(medGap)),
      count: sorted.length,
    });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;

  // Default to the month of the most recent transaction.
  const latest = await listTransactions(DEFAULT_USER_ID, { limit: 1 });
  const fallback = latest[0]
    ? { y: Number(latest[0].date.slice(0, 4)), mo: Number(latest[0].date.slice(5, 7)) - 1 }
    : { y: new Date().getFullYear(), mo: new Date().getMonth() };
  const { y, mo } = parseYm(m) ?? fallback;

  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const firstWeekday = new Date(y, mo, 1).getDay();
  const monthStart = `${y}-${pad(mo + 1)}-01`;
  const monthEnd = `${y}-${pad(mo + 1)}-${pad(daysInMonth)}`;
  const monthLabel = new Date(y, mo, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const prev = shiftMonth(y, mo, -1);
  const next = shiftMonth(y, mo, 1);

  const [txs, hist] = await Promise.all([
    listTransactions(DEFAULT_USER_ID, { from: monthStart, to: monthEnd, limit: 1000 }),
    listTransactions(DEFAULT_USER_ID, { from: addDays(monthEnd, -150), to: monthEnd, limit: 2000 }),
  ]);

  // Group the month's transactions by day.
  const byDay = new Map<number, Tx[]>();
  for (const t of txs) {
    const d = Number(t.date.slice(8, 10));
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(t);
  }
  const dayTotal = (d: number) => (byDay.get(d) ?? []).reduce((s, t) => s + Math.max(0, t.amount), 0);
  const maxDay = Math.max(1, ...Array.from({ length: daysInMonth }, (_, i) => dayTotal(i + 1)));

  const monthTotal = txs.reduce((s, t) => s + Math.max(0, t.amount), 0);
  const recurring = detectRecurring(hist);
  const recurringMonthly = recurring.reduce(
    (s, r) => s + r.amount * (r.cadence === "weekly" ? 4.33 : r.cadence === "biweekly" ? 2.17 : r.cadence === "yearly" ? 1 / 12 : 1),
    0
  );
  const busiest = Array.from({ length: daysInMonth }, (_, i) => i + 1).sort((a, b) => dayTotal(b) - dayTotal(a))[0];

  const today = new Date();
  const todayKey = today.getFullYear() === y && today.getMonth() === mo ? today.getDate() : -1;

  // Build the grid cells (leading blanks + days).
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="rise mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Calendar 📅</h1>
          <p className="mt-1 text-[14px] text-muted">
            What you spent, day by day — and what&apos;s coming up.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            href={`/calendar?m=${ymStr(prev.y, prev.mo)}`}
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink-soft transition hover:bg-cream"
            aria-label="Previous month"
          >
            ←
          </Link>
          <span className="min-w-[150px] text-center font-display text-lg font-semibold text-ink">{monthLabel}</span>
          <Link
            href={`/calendar?m=${ymStr(next.y, next.mo)}`}
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink-soft transition hover:bg-cream"
            aria-label="Next month"
          >
            →
          </Link>
        </div>
      </header>

      {/* Stat tiles */}
      <section className="rise mb-5 grid grid-cols-3 gap-3">
        <Stat label="Spent this month" value={money(monthTotal)} />
        <Stat label="Recurring / mo" value={money(recurringMonthly)} accent />
        <Stat label="Busiest day" value={dayTotal(busiest) > 0 ? `${monthLabel.split(" ")[0].slice(0, 3)} ${busiest}` : "—"} sub={dayTotal(busiest) > 0 ? money(dayTotal(busiest)) : ""} />
      </section>

      {/* Calendar grid */}
      <Card className="rise overflow-hidden p-3 sm:p-4">
        <div className="mb-1 grid grid-cols-7">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((d, i) => {
            if (d === null) return <div key={`b${i}`} className="aspect-square rounded-xl" />;
            const list = byDay.get(d) ?? [];
            const total = dayTotal(d);
            const intensity = total > 0 ? 0.1 + 0.55 * (total / maxDay) : 0;
            const isToday = d === todayKey;
            // distinct merchants for the day's logos
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
                className={`relative flex aspect-square flex-col rounded-xl border p-1.5 sm:p-2 ${
                  isToday ? "border-sprout ring-1 ring-sprout/40" : "border-line/70"
                }`}
                style={{ background: total > 0 ? `rgba(15,169,104,${intensity})` : undefined }}
              >
                <span className={`text-[11px] font-semibold ${isToday ? "text-sprout-deep" : "text-ink-soft"}`}>{d}</span>
                {total > 0 && (
                  <>
                    <span className="amount mt-0.5 text-[11px] font-semibold leading-none text-ink sm:text-[12.5px]">
                      {money(total)}
                    </span>
                    <div className="mt-auto flex flex-wrap gap-0.5">
                      {marks.slice(0, 3).map((t) => (
                        <MerchantBadge
                          key={t.id}
                          chip={chipFor(t.merchant)}
                          emoji={emojiFor(t.merchant)}
                          connectorKey={t.connectorKey}
                          size={16}
                        />
                      ))}
                      {marks.length > 3 && <span className="self-end text-[10px] text-muted">+{marks.length - 3}</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Recurring / subscriptions */}
      <section className="rise mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl font-semibold text-ink">Recurring charges</h2>
          <span className="text-[13px] text-muted">{recurring.length} found · {money(recurringMonthly)}/mo</span>
        </div>
        {recurring.length === 0 ? (
          <Card className="px-4 py-8 text-center text-[14px] text-muted">
            No recurring charges detected yet — they show up once a merchant bills you on a steady cadence.
          </Card>
        ) : (
          <Card className="divide-y divide-line/70 overflow-hidden">
            {recurring.map((r) => (
              <div key={r.merchant + r.nextDate} className="flex items-center gap-3.5 px-4 py-3">
                <MerchantBadge chip={chipFor(r.merchant)} emoji={emojiFor(r.merchant)} connectorKey={r.connectorKey} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{r.merchant}</p>
                  <p className="text-[12.5px] text-muted">
                    {r.cadence} · next {longDate(r.nextDate)}
                  </p>
                </div>
                <span className="amount text-[15px] font-semibold text-ink">{money(r.amount)}</span>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className={`p-4 ${accent ? "ring-1 ring-sprout/30" : ""}`}>
      <p className="text-[12.5px] font-medium text-muted">{label}</p>
      <p className={`amount mt-1 text-xl font-semibold ${accent ? "text-sprout-deep" : "text-ink"}`}>{value}</p>
      {sub ? <p className="amount text-[12px] text-muted">{sub}</p> : null}
    </Card>
  );
}
