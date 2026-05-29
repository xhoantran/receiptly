/**
 * DB client. SQLite today; the rest of the app imports `db` from here and never
 * touches the driver directly, so swapping to Postgres later means only this file
 * + schema.ts change.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import * as schema from "./schema.js";

// Resolve the data dir relative to THIS file (src/db/index.ts → repo root /data),
// not process.cwd(), so CLIs (run from root) and the Next server (run from web/)
// share the same database. Override with RECEIPTLY_DATA_DIR if needed.
const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RECEIPTLY_DATA_DIR ?? resolve(here, "../../data");
mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new Database(resolve(DATA_DIR, "receiptly.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };
export type DB = typeof db;
