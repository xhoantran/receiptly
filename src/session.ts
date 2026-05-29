/**
 * Session manager — the one place that acquires and reuses merchant logins.
 *
 *   login(connector)        opens a real browser, waits until you're signed in
 *                           (auto-detected via connector.isLoggedIn), saves the
 *                           session, closes.
 *   openSession(connector)  reopens with the saved session for scraping; throws
 *                           a clear "run login first" error if missing/expired.
 *
 * Sessions are storageState JSON under data/sessions/<key>.json — cookies +
 * localStorage, local to this machine.
 */
import { webkit, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Connector } from "./connectors/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR =
  process.env.RECEIPTLY_DATA_DIR
    ? resolve(process.env.RECEIPTLY_DATA_DIR, "sessions")
    : resolve(here, "../data/sessions");

export function sessionPath(key: string): string {
  return resolve(SESSIONS_DIR, `${key}.json`);
}
export function hasSession(key: string): boolean {
  return existsSync(sessionPath(key));
}

async function launch(): Promise<Browser> {
  // WebKit passes most bot defenses (Akamai etc.) and carries no automation flags.
  return webkit.launch({ headless: false });
}

async function makeContext(browser: Browser, key: string, useSaved: boolean): Promise<BrowserContext> {
  const path = sessionPath(key);
  return browser.newContext({
    storageState: useSaved && existsSync(path) ? path : undefined,
    viewport: null,
    locale: "en-US",
    timezoneId: "America/New_York",
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The one primitive: open the merchant, ensure we're signed in (reusing a saved
 * session, or waiting for an interactive sign-in and saving it), then hand the
 * authenticated page to `fn`. Both `login` and `scrape` are built on this.
 */
export async function withSession<T>(
  connector: Connector,
  fn: (page: Page) => Promise<T>,
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const browser = await launch();
  const context = await makeContext(browser, connector.key, true);
  const page = await context.newPage();

  try {
    await page.goto(connector.loginUrl, { waitUntil: "domcontentloaded" });

    if (!(await connector.isLoggedIn(page).catch(() => false))) {
      console.log(`\n→ Sign in to ${connector.displayName} in the window — I'll continue automatically once you're in.\n`);
      const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
      while (Date.now() < deadline) {
        await sleep(2000);
        if (await connector.isLoggedIn(page).catch(() => false)) break;
      }
      if (!(await connector.isLoggedIn(page).catch(() => false))) {
        throw new Error("timed out waiting for sign-in");
      }
    }

    await context.storageState({ path: sessionPath(connector.key) });
    return await fn(page);
  } finally {
    try {
      await context.storageState({ path: sessionPath(connector.key) }); // refresh rolling cookies
    } catch {}
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/** Just acquire/refresh a session, no scraping. */
export async function login(connector: Connector): Promise<void> {
  await withSession(connector, async () => {
    console.log(`[${connector.key}] ✓ session saved`);
  });
}

export function listSessions(keys: string[]): { key: string; saved: boolean }[] {
  return keys.map((key) => ({ key, saved: hasSession(key) }));
}
