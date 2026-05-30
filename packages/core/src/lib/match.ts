import type { Tx } from "./plaid.js";
import type { ExtractedReceipt } from "./extract.js";

export type Match = {
  tx: Tx;
  receipt: ExtractedReceipt | null;
  confidence: "exact" | "close" | "none";
  delta_amount?: number;
  delta_days?: number;
  /** Minutes between the transaction's authorized time and the receipt time, when
   * both are known — the tiebreaker for same-day, same-amount candidates. */
  delta_minutes?: number;
};

const MAX_DAYS = 3;
const EXACT_DELTA = 0.01;
const CLOSE_DELTA = 1.0;

type Cand = { idx: number; dDays: number; timed: boolean; dMin: number };

export function matchReceiptsToTransactions(
  txs: Tx[],
  receipts: ExtractedReceipt[]
): Match[] {
  const used = new Set<number>();
  const matches = new Map<string, Match>();

  // Pass 1: exact amount → closest in time (nearest day, then nearest clock time
  // when both the charge's authorized time and the receipt time are known).
  for (const tx of txs) {
    let best: Cand | null = null;
    for (let i = 0; i < receipts.length; i++) {
      if (used.has(i)) continue;
      const r = receipts[i];
      if (Math.abs(tx.amount - r.total) > EXACT_DELTA) continue;
      const c = candidate(i, tx, r);
      if (c.dDays > MAX_DAYS) continue;
      if (!best || closer(c, best)) best = c;
    }
    if (best) {
      used.add(best.idx);
      matches.set(tx.id, {
        tx,
        receipt: receipts[best.idx],
        confidence: "exact",
        delta_amount: Math.abs(tx.amount - receipts[best.idx].total),
        delta_days: best.dDays,
        delta_minutes: best.timed ? Math.round(best.dMin) : undefined,
      });
    }
  }

  // Pass 2: close amount for anything still unmatched (amount first, then time).
  for (const tx of txs) {
    if (matches.has(tx.id)) continue;
    let best: (Cand & { dAmt: number }) | null = null;
    for (let i = 0; i < receipts.length; i++) {
      if (used.has(i)) continue;
      const r = receipts[i];
      const dAmt = Math.abs(tx.amount - r.total);
      if (dAmt > CLOSE_DELTA) continue;
      const c = { ...candidate(i, tx, r), dAmt };
      if (c.dDays > MAX_DAYS) continue;
      if (!best || dAmt < best.dAmt || (dAmt === best.dAmt && closer(c, best))) best = c;
    }
    if (best) {
      used.add(best.idx);
      matches.set(tx.id, {
        tx,
        receipt: receipts[best.idx],
        confidence: "close",
        delta_amount: best.dAmt,
        delta_days: best.dDays,
        delta_minutes: best.timed ? Math.round(best.dMin) : undefined,
      });
    } else {
      matches.set(tx.id, { tx, receipt: null, confidence: "none" });
    }
  }

  return txs.map((t) => matches.get(t.id)!);
}

function candidate(idx: number, tx: Tx, r: ExtractedReceipt): Cand {
  const dDays = Math.abs(daysBetween(tx.date, r.date));
  const t = tx.authorized_datetime ? Date.parse(tx.authorized_datetime) : NaN;
  const rt = r.purchased_at ? Date.parse(r.purchased_at) : NaN;
  const timed = !Number.isNaN(t) && !Number.isNaN(rt);
  return { idx, dDays, timed, dMin: timed ? Math.abs(t - rt) / 60_000 : Infinity };
}

// Nearest day wins; within the same day a known-and-closer clock time wins, and a
// timed candidate beats an untimed one. Untimed candidates still match (date only).
function closer(a: Cand, b: Cand): boolean {
  if (a.dDays !== b.dDays) return a.dDays < b.dDays;
  if (a.timed && b.timed) return a.dMin < b.dMin;
  if (a.timed !== b.timed) return a.timed;
  return false;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(a) - Date.parse(b)) / 86_400_000;
}
