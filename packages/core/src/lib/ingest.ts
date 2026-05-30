/**
 * Shared ingest pipeline: persist receipts → rematch that merchant's
 * transactions → resolve items into canonical products.
 * Used by the on-device `/raw` ingest route and any offline rebuild.
 *
 * Multi-tenant: a leading `userId` scopes the per-user reads/writes. Product
 * resolution touches the GLOBAL catalog and stays user-agnostic.
 */
import { listTransactions, listReceipts, saveReceipts, saveMatches, markConnectorSynced } from "../db/repo.js";
import { matchReceiptsToTransactions } from "./match.js";
import { resolveProducts } from "./products.js";
import type { Tx } from "./plaid.js";
import type { ExtractedReceipt } from "./extract.js";

export async function rematchConnector(userId: string, key: string): Promise<{ exact: number; total: number }> {
  const txRows = await listTransactions(userId, { connectorKey: key, limit: 1000 });
  const rcptRows = await listReceipts(userId, key);

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
    // The full timestamp lives in the stored raw payload (we don't keep a column).
    purchased_at: (r.raw as { purchased_at?: string | null } | null)?.purchased_at ?? null,
    store: r.store,
    total: r.total,
    subtotal: r.subtotal,
    tax: r.tax,
    items: [],
  })) as (ExtractedReceipt & { _id: string })[];

  const matches = matchReceiptsToTransactions(txs, receipts);
  await saveMatches(
    userId,
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
  userId: string,
  key: string,
  receipts: ExtractedReceipt[]
): Promise<{ receipts: number; matched: number; total: number; resolved: number; products: number }> {
  await saveReceipts(userId, key, receipts);
  const { exact, total } = await rematchConnector(userId, key);
  const { resolved, created } = await resolveProducts(userId);
  await markConnectorSynced(userId, key);
  return { receipts: receipts.length, matched: exact, total, resolved, products: created };
}
