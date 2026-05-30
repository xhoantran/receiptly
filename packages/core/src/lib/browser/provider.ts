/**
 * Browser provider — the one place that launches a browser context for a
 * merchant session, whether to scrape headlessly or to drive a remote
 * interactive login (the live-view worker streams JPEG screenshots of the page).
 *
 * WebKit ONLY: WebKit carries no automation flags and passes most merchant bot
 * defenses (Akamai etc.) where Chromium is fingerprinted and blocked. This is
 * the same engine the local CLI flow (session.ts) uses, and like it we run
 * HEADED by default — headless WebKit is fingerprinted and blocked (it gets
 * served degraded/challenge pages and OTP steps stall). Set BROWSER_HEADLESS=true
 * on a headless server (with a virtual display) or use a remote provider.
 *
 * The `BrowserProvider` interface lets the hosted control plane swap in a
 * remote/CDP-backed provider later (a pool of browsers on dedicated infra)
 * without changing the scrape/worker callers — see the comment on
 * `browserProvider` below.
 */
import { webkit, type Browser, type BrowserContext, type Page } from "playwright";

export type Viewport = { width: number; height: number };

/** Default login/scrape viewport — fixed so the live-view canvas matches 1:1. */
export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 };

export type OpenContextOptions = {
  /** storageState JSON (as produced by captureState) to restore cookies + localStorage. */
  storageState?: string;
  /** Viewport for the context; defaults to {@link DEFAULT_VIEWPORT}. */
  viewport?: Viewport;
  /**
   * Run headless. Defaults to HEADED (false) — merchant bot defenses flag
   * headless WebKit. Set BROWSER_HEADLESS=true (server w/ virtual display) to override.
   */
  headless?: boolean;
};

export type OpenedContext = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

/**
 * Swappable browser backend. `LocalBrowserProvider` launches WebKit in-process.
 * A hosted provider (remote/CDP) implements the same interface so `runScrape`
 * and the live-view worker never change.
 */
export interface BrowserProvider {
  /** Launch a browser + context (+ a fresh page) ready to navigate. */
  openContext(opts?: OpenContextOptions): Promise<OpenedContext>;
  /** Serialize the context's storageState (cookies + localStorage) to JSON. */
  captureState(context: BrowserContext): Promise<string>;
}

/** Local, in-process WebKit provider. */
export class LocalBrowserProvider implements BrowserProvider {
  async openContext(opts: OpenContextOptions = {}): Promise<OpenedContext> {
    const headless = opts.headless ?? process.env.BROWSER_HEADLESS === "true";
    const browser = await webkit.launch({ headless });
    const context = await browser.newContext({
      // Stealth-ish parity with the local headful flow (session.ts).
      locale: "en-US",
      timezoneId: "America/New_York",
      viewport: opts.viewport ?? DEFAULT_VIEWPORT,
      // Playwright accepts storageState as a JSON string or a parsed object.
      storageState: opts.storageState ? JSON.parse(opts.storageState) : undefined,
    });
    const page = await context.newPage();
    return { browser, context, page };
  }

  async captureState(context: BrowserContext): Promise<string> {
    return JSON.stringify(await context.storageState());
  }
}

/**
 * The active provider. The hosted control plane could swap this for a CDP/remote
 * stealth-browser provider — same interface, so scrape.ts and the live-view
 * worker are unaffected. (For local/self-host the on-device desktop/mobile app is
 * the merchant-login path that actually clears Akamai; see docs/ARCHITECTURE.md.)
 */
export const browserProvider: BrowserProvider = new LocalBrowserProvider();
