import type { Tx } from "./plaid.js";
import type { ExtractedReceipt } from "./extract.js";

export type Match = {
  tx: Tx;
  receipt: ExtractedReceipt | null;
  confidence: "exact" | "close" | "none";
  delta_amount?: number;
  delta_days?: number;
};

const MAX_DAYS = 3;
const EXACT_DELTA = 0.01;
const CLOSE_DELTA = 1.0;

export function matchReceiptsToTransactions(
  txs: Tx[],
  receipts: ExtractedReceipt[]
): Match[] {
  const used = new Set<number>();
  const matches = new Map<string, Match>();

  // Pass 1: exact amount + closest date
  for (const tx of txs) {
    let best: { idx: number; dDays: number } | null = null;
    for (let i = 0; i < receipts.length; i++) {
      if (used.has(i)) continue;
      const r = receipts[i];
      if (Math.abs(tx.amount - r.total) > EXACT_DELTA) continue;
      const dDays = Math.abs(daysBetween(tx.date, r.date));
      if (dDays > MAX_DAYS) continue;
      if (!best || dDays < best.dDays) best = { idx: i, dDays };
    }
    if (best) {
      used.add(best.idx);
      matches.set(tx.id, {
        tx,
        receipt: receipts[best.idx],
        confidence: "exact",
        delta_amount: Math.abs(tx.amount - receipts[best.idx].total),
        delta_days: best.dDays,
      });
    }
  }

  // Pass 2: close amount for anything still unmatched
  for (const tx of txs) {
    if (matches.has(tx.id)) continue;
    let best: { idx: number; dAmt: number; dDays: number } | null = null;
    for (let i = 0; i < receipts.length; i++) {
      if (used.has(i)) continue;
      const r = receipts[i];
      const dAmt = Math.abs(tx.amount - r.total);
      if (dAmt > CLOSE_DELTA) continue;
      const dDays = Math.abs(daysBetween(tx.date, r.date));
      if (dDays > MAX_DAYS) continue;
      if (!best || dAmt < best.dAmt || (dAmt === best.dAmt && dDays < best.dDays)) {
        best = { idx: i, dAmt, dDays };
      }
    }
    if (best) {
      used.add(best.idx);
      matches.set(tx.id, {
        tx,
        receipt: receipts[best.idx],
        confidence: "close",
        delta_amount: best.dAmt,
        delta_days: best.dDays,
      });
    } else {
      matches.set(tx.id, { tx, receipt: null, confidence: "none" });
    }
  }

  return txs.map((t) => matches.get(t.id)!);
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(a) - Date.parse(b)) / 86_400_000;
}
