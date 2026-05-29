/**
 * Discovery: open a merchant in a real browser with the saved session (if any),
 * let the user click around, and capture every JSON/HTML response to disk so a
 * connector can be built from what the site actually does.
 */
import { webkit, type Response } from "playwright";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { connectorsByKey } from "./connectors/index.js";
import { sessionPath } from "./session.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RECEIPTLY_DATA_DIR ?? resolve(here, "../data");

export async function discover(merchant: string): Promise<void> {
  const connector = connectorsByKey[merchant];
  if (!connector) throw new Error(`unknown merchant "${merchant}"`);
  const startUrl = connector.loginUrl;
  const host = new URL(startUrl).hostname.replace(/^www\./, "");
  const domainRe = new RegExp(host.replace(/\./g, "\\."));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = resolve(DATA_DIR, "discovery", `${merchant}-${stamp}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  console.log(`Discovery output → ${outDir}`);

  const browser = await webkit.launch({ headless: false });
  const context = await browser.newContext({
    storageState: existsSync(sessionPath(merchant)) ? sessionPath(merchant) : undefined,
    viewport: null,
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();

  const captured: { idx: number; status: number; method: string; url: string; bytes: number; saved: string | null }[] = [];
  let idx = 0;
  page.on("response", async (res: Response) => {
    const url = res.url();
    if (!domainRe.test(url)) return;
    if (/\.(png|jpg|jpeg|svg|webp|ico|woff2?|ttf|css|js|map)(\?|$)/i.test(url)) return;
    if (/google|doubleclick|facebook|segment|hotjar|datadog|newrelic|optimizely|onetrust|adobe|cdn-cgi/.test(url)) return;
    const ct = res.headers()["content-type"] ?? "";
    if (!ct.includes("json") && !ct.includes("html")) return;
    let body: Buffer | null = null;
    try { body = await res.body(); } catch { return; }
    const i = idx++;
    const ext = ct.includes("json") ? "json" : "html";
    const fname = `${String(i).padStart(4, "0")}-${res.status()}-${res.request().method()}-${url.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_").slice(0, 80)}.${ext}`;
    const p = resolve(outDir, fname);
    await writeFile(p, body);
    captured.push({ idx: i, status: res.status(), method: res.request().method(), url, bytes: body.length, saved: fname });
  });

  await page.goto(startUrl, { waitUntil: "domcontentloaded" });
  console.log("\n→ Browse the merchant: sign in, open your orders, click into a few receipts.");
  console.log("→ Every JSON/HTML response is being saved.\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter when done exploring: ");
  rl.close();

  await context.storageState({ path: sessionPath(merchant) });
  await writeFile(resolve(outDir, "_index.json"), JSON.stringify({ merchant, startUrl, count: captured.length, requests: captured }, null, 2));
  await context.close();
  await browser.close();

  console.log(`\nCaptured ${captured.length} responses.`);
  const apis = captured.filter((c) => /\/api\/|graphql/i.test(c.url));
  if (apis.length) {
    console.log("API-looking calls:");
    for (const a of apis) console.log(`  ${a.status} ${a.method} ${a.url}`);
  }
  console.log(`\nInspect: ${resolve(outDir, "_index.json")}`);
}
