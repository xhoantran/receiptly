// Creates a Plaid Link token for the current user. Phase 0 is single-user, so it
// uses DEFAULT_USER_ID; Phase 1 swaps in the authenticated user.
//
// The engine modules are imported lazily INSIDE the handler: @receiptly/core's
// plaid module validates PLAID_* at module-load (config.ts), so a static import
// would 500 the route before we can return a friendly "not configured" message.
export const runtime = "nodejs";

export async function POST() {
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return Response.json(
      { error: "Set PLAID_CLIENT_ID and PLAID_SECRET in .env to connect a bank." },
      { status: 400 }
    );
  }
  try {
    const { createLinkToken } = await import("@receiptly/core/lib/plaid.js");
    const { DEFAULT_USER_ID } = await import("@receiptly/core/lib/constants.js");
    const link_token = await createLinkToken(DEFAULT_USER_ID);
    return Response.json({ link_token });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
