/**
 * Phase 0 is single-user: the CLI and the (not-yet-authenticated) web app run
 * as one seeded tenant. Every engine call is threaded a `userId`, and in Phase
 * 0 that value is always this constant. Phase 1 swaps in the authenticated
 * user's id from Better Auth, at which point this default disappears from the
 * call sites.
 */
export const DEFAULT_USER_ID = "default-user";
