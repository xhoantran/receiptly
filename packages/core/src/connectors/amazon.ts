import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractReceiptDetailFromHtml } from "../lib/extract.js";
import type { Connector, ExtractedReceipt, Tx } from "./types.js";
import type { Page } from "playwright";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");

const KEY = "amazon";
const ORDERS_URL = "https://www.amazon.com/your-orders/orders";
const INVOICE_URL = (id: string) =>
  `https://www.amazon.com/gp/css/summary/print.html?orderID=${id}`;

// Bound a single run. Amazon order lists can be huge; the matcher only needs the
// recent window that overlaps the user's transactions.
const MAX_ORDERS = Number(process.env.AMAZON_MAX_ORDERS ?? 30);

type OrderRef = { orderId: string; date: string; total: number };

/**
 * Amazon has NO JSON receipt API — order history is server-rendered HTML and
 * per-item prices live on the printable invoice. So this is the browser+LLM path:
 *   1. page through the order list, scrape {orderId, date, total} from each card
 *   2. open each order's printable invoice, read its text
 *   3. hand the invoice text to Claude → structured items (extract.ts)
 * The order CARD is authoritative for date+total; Claude fills in the line items.
 */
export const amazonConnector: Connector = {
  key: KEY,
  displayName: "Amazon",
  mode: "browser",
  loginUrl: ORDERS_URL,

  matches(tx: Tx) {
    return /amazon|amzn/i.test(`${tx.merchant} ${tx.raw_name}`);
  },

  async isLoggedIn(page: Page) {
    const u = page.url();
    return u.includes("/your-orders") && !u.includes("/ap/signin");
  },

  async fetchReceipts(ctx): Promise<ExtractedReceipt[]> {
    const debug = resolve(DATA_DIR, "debug");
    await mkdir(debug, { recursive: true });
    const { page } = ctx;

    {
      // ── 1. Collect order refs across paginated list pages ──
      const orders: OrderRef[] = [];
      for (let start = 0; start < MAX_ORDERS; start += 10) {
        console.log(`[${KEY}] order list @ startIndex=${start}`);
        await page.goto(`${ORDERS_URL}?startIndex=${start}`, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

        const pageOrders: OrderRef[] = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll<HTMLElement>('[class*="order-card"]'));
          const out: { orderId: string; date: string; total: number }[] = [];
          for (const card of cards) {
            const text = card.innerText.replace(/\s+/g, " ");
            const invoice = card.querySelector<HTMLAnchorElement>('a[href*="orderID="]');
            const idMatch = invoice?.href.match(/orderID=([\w-]+)/);
            const dateMatch = text.match(/Order placed\s+([A-Za-z]+ \d{1,2}, \d{4})/);
            const totalMatch = text.match(/Total\s+\$([\d,]+\.\d{2})/);
            if (!idMatch || !dateMatch || !totalMatch) continue;
            const d = new Date(dateMatch[1]);
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            out.push({ orderId: idMatch[1], date: iso, total: Number(totalMatch[1].replace(/,/g, "")) });
          }
          return out;
        });

        if (pageOrders.length === 0) break;
        orders.push(...pageOrders);
        if (pageOrders.length < 10) break;
      }
      // de-dupe by orderId
      const unique = [...new Map(orders.map((o) => [o.orderId, o])).values()];
      console.log(`[${KEY}] ${unique.length} orders found.\n`);

      // ── 2 + 3. Per order: read invoice text → Claude → items ──
      const receipts: ExtractedReceipt[] = [];
      for (let i = 0; i < unique.length; i++) {
        const o = unique[i];
        console.log(`[${KEY}] [${i + 1}/${unique.length}] ${o.date} $${o.total} (${o.orderId})`);
        try {
          await page.goto(INVOICE_URL(o.orderId), { waitUntil: "domcontentloaded" });
          const text = await page.innerText("body");
          await writeFile(resolve(debug, `amazon-invoice-${o.orderId}.txt`), text);

          const extracted = await extractReceiptDetailFromHtml(text);
          receipts.push({
            ...extracted,
            receipt_id: o.orderId, // card is authoritative
            date: o.date,
            total: o.total,
            store: "Amazon",
          });
          console.log(`[${KEY}]   → ${extracted.items.length} items`);
        } catch (err) {
          console.error(`[${KEY}]   ✗ ${String(err).slice(0, 120)}`);
        }
        await new Promise((r) => setTimeout(r, 800));
      }

      return receipts;
    }
  },
};
