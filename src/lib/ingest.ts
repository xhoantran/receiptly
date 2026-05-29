/**
 * Shared ingest pipeline: persist receipts → rematch that merchant's
 * transactions → resolve items into canonical products.
 * Used by `receiptly scrape` and any offline rebuild.
 */
import { listTransactions, listReceipts, saveReceipts, saveMatches, markConnectorSynced } from "../db/repo.js";
import { matchReceiptsToTransactions } from "./match.js";
import { resolveProducts } from "./products.js";
import type { Tx } from "./plaid.js";
import type { ExtractedReceipt } from "./extract.js";

export async function rematchConnector(key: string): Promise<{ exact: number; total: number }> {
  const txRows = await listTransactions({ connectorKey: key, limit: 1000 });
  const rcptRows = await listReceipts(key);

  const txs: Tx[] = txRows.map((t) => ({
    id: t.id,
    date: t.date,
    authorized_datetime: t.authorizedDatetime,
    amount: t.amount,
    merchant: t.merchant,
    raw_name: t.rawName,
    pending: t.pending,
    account_id: t.accountId,
  }));
  const receipts = rcptRows.map((r) => ({
    _id: r.id,
    receipt_id: r.id,
    date: r.date,
    store: r.store,
    total: r.total,
    subtotal: r.subtotal,
    tax: r.tax,
    items: [],
  })) as (ExtractedReceipt & { _id: string })[];

  const matches = matchReceiptsToTransactions(txs, receipts);
  await saveMatches(
    matches.map((m) => ({
      transactionId: m.tx.id,
      receiptId: m.receipt ? (m.receipt as any)._id ?? String(m.receipt.receipt_id) : null,
      confidence: m.confidence,
      deltaAmount: m.delta_amount,
      deltaDays: m.delta_days,
    }))
  );
  const exact = matches.filter((m) => m.confidence === "exact").length;
  return { exact, total: txs.length };
}

export async function ingest(
  key: string,
  receipts: ExtractedReceipt[]
): Promise<{ receipts: number; matched: number; total: number; resolved: number; products: number }> {
  await saveReceipts(key, receipts);
  const { exact, total } = await rematchConnector(key);
  const { resolved, created } = await resolveProducts();
  await markConnectorSynced(key);
  return { receipts: receipts.length, matched: exact, total, resolved, products: created };
}
