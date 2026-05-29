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
import { webkit, chromium, type Browser, type BrowserContext, type Page } from "playwright";

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
  /** Interactive live-view URL to embed in an iframe (remote providers only). */
  liveViewUrl?: string;
  /** Provider-specific cleanup (e.g. release the remote session). */
  dispose?: () => Promise<void>;
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
 * Remote provider backed by Browserbase: a stealth Chromium on residential infra
 * with an interactive live-view. The user logs in inside Browserbase's iframe
 * (real input telemetry + residential IP), which clears Akamai-class bot defenses
 * that the local canvas/forwarded-input path cannot. We drive scraping over CDP.
 */
export class RemoteBrowserProvider implements BrowserProvider {
  async openContext(opts: OpenContextOptions = {}): Promise<OpenedContext> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!apiKey || !projectId)
      throw new Error(
        "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set for BROWSER_PROVIDER=browserbase."
      );

    const { default: Browserbase } = await import("@browserbasehq/sdk");
    const bb = new Browserbase({ apiKey });

    const vp = opts.viewport ?? DEFAULT_VIEWPORT;
    // Residential proxies + captcha-solving are PAID Browserbase features and the
    // strongest Akamai levers, but they 402 on the free plan. Gate them behind
    // BROWSERBASE_PROXIES=true (set it once you're on a paid plan).
    const paid = process.env.BROWSERBASE_PROXIES === "true";
    const session = await bb.sessions.create({
      projectId,
      proxies: paid,
      browserSettings: {
        blockAds: true,
        solveCaptchas: paid,
        viewport: { width: vp.width, height: vp.height },
      },
    });

    const browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    // Restore a prior login (cookies) if we captured one before.
    if (opts.storageState) {
      try {
        const state = JSON.parse(opts.storageState) as {
          cookies?: Parameters<BrowserContext["addCookies"]>[0];
        };
        if (state.cookies?.length) await context.addCookies(state.cookies);
      } catch {
        /* ignore malformed state */
      }
    }

    const debug = await bb.sessions.debug(session.id);
    const liveViewUrl = debug.debuggerFullscreenUrl;

    const dispose = async () => {
      await browser.close().catch(() => {});
      await bb.sessions
        .update(session.id, { projectId, status: "REQUEST_RELEASE" })
        .catch(() => {});
    };

    return { browser, context, page, liveViewUrl, dispose };
  }

  async captureState(context: BrowserContext): Promise<string> {
    return JSON.stringify(await context.storageState());
  }
}

/**
 * The active provider, selected by BROWSER_PROVIDER:
 *   - "browserbase" → RemoteBrowserProvider (stealth Chromium for Akamai-class sites)
 *   - else          → LocalBrowserProvider  (in-process WebKit + canvas live-view)
 * Same interface, so scrape.ts and the live-view worker are unaffected either way.
 */
export const browserProvider: BrowserProvider =
  process.env.BROWSER_PROVIDER === "browserbase"
    ? new RemoteBrowserProvider()
    : new LocalBrowserProvider();
