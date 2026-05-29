/**
 * Better Auth instance.
 *
 * Phase 0 only *constructs* the instance and aligns it with the hand-written
 * Drizzle (pg) tables in `db/schema.ts` (`user`/`session`/`account`/
 * `verification`). It is NOT mounted on an HTTP route yet — Phase 1 wires the
 * handler into the API and replaces the single seeded `DEFAULT_USER_ID` tenant
 * with the authenticated user's id.
 *
 * Email/password is the only enabled method for now (self-host friendly: no
 * external IdP required). `BETTER_AUTH_SECRET` signs sessions/tokens.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
import { user, session, account, verification } from "../db/schema.js";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
  },
  secret: process.env.BETTER_AUTH_SECRET,
});
