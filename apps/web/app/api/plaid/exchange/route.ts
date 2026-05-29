// Exchanges a Plaid public_token for an access token, stores the item (encrypted
// at the repo boundary), and pulls the user's transactions. Single-user in Phase 0.
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return Response.json({ error: "Plaid isn't configured on the server." }, { status: 400 });
  }

  let publicToken: string | undefined;
  try {
    ({ public_token: publicToken } = (await req.json()) as { public_token?: string });
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!publicToken) return Response.json({ error: "Missing public_token." }, { status: 400 });

  try {
    const { exchangePublicToken } = await import("@receiptly/core/lib/plaid.js");
    const { savePlaidItem } = await import("@receiptly/core/db/repo.js");
    const { syncAll } = await import("@receiptly/core/lib/plaid-sync.js");
    const { DEFAULT_USER_ID } = await import("@receiptly/core/lib/constants.js");

    const ex = await exchangePublicToken(publicToken);
    await savePlaidItem(DEFAULT_USER_ID, { itemId: ex.item_id, accessToken: ex.access_token });
    const { items, added } = await syncAll(DEFAULT_USER_ID);

    return Response.json({ ok: true, item_id: ex.item_id, items, added });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
