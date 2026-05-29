/**
 * DB client. Postgres (postgres.js driver) + Drizzle's pg dialect. The rest of
 * the app imports `db` from here and never touches the driver directly, so the
 * connection details live in exactly one place.
 *
 * Connection comes from `DATABASE_URL` (e.g.
 * `postgres://user:pass@host:5432/receiptly`). Self-host points it at a local
 * Docker Postgres; hosted points it at a managed Postgres. There is no longer a
 * local data dir / SQLite file.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Point it at a Postgres database, e.g. " +
      "postgres://postgres:postgres@localhost:5432/receiptly"
  );
}

const client = postgres(url);

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;
