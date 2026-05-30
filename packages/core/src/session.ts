/**
 * Merchant session storage path — where a saved login (Playwright storageState
 * JSON) lives on disk, under data/sessions/<key>.json.
 *
 * The interactive server-side login/scrape that used to live here (a non-headless
 * WebKit browser the user signed into) was retired in favor of ON-DEVICE capture
 * (the native desktop/mobile app). `discover` still reads this path to reuse a
 * saved session while reverse-engineering a merchant's API.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = process.env.RECEIPTLY_DATA_DIR
  ? resolve(process.env.RECEIPTLY_DATA_DIR, "sessions")
  : resolve(here, "../data/sessions");

export function sessionPath(key: string): string {
  return resolve(SESSIONS_DIR, `${key}.json`);
}
