// Pulls new transactions for the user's linked banks. Plaid fetches transaction
// history asynchronously after linking, so the first sync right after connecting
// often returns nothing — the client polls this until data arrives (and it backs
// the "Sync now" affordance).
export const runtime = "nodejs";

export async function POST() {
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return Response.json({ error: "Plaid isn't configured on the server." }, { status: 400 });
  }
  try {
    const { syncAll } = await import("@receiptly/core/lib/plaid-sync.js");
    const { DEFAULT_USER_ID } = await import("@receiptly/core/lib/constants.js");
    const { items, added } = await syncAll(DEFAULT_USER_ID);
    return Response.json({ ok: true, items, added });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
