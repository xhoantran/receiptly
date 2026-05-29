import { listPlaidItems, updateCursor, upsertTransactions } from "../db/repo.js";
import { syncTransactions } from "./plaid.js";
import { findConnector } from "../connectors/index.js";

/** Pull new transactions for every linked Plaid item into the DB, scoped to one user. */
export async function syncAll(userId: string): Promise<{ items: number; added: number }> {
  const items = await listPlaidItems(userId);
  let added = 0;
  for (const it of items) {
    const res = it.cursor
      ? await syncTransactions(it.accessToken, it.cursor)
      : await syncTransactions(it.accessToken);
    await upsertTransactions(userId, res.added, (t) => findConnector(t)?.key ?? null);
    if (res.cursor) await updateCursor(userId, it.itemId, res.cursor);
    added += res.added.length;
  }
  return { items: items.length, added };
}
