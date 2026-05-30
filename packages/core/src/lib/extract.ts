import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

export type ReceiptItem = {
  name: string;
  qty: number;
  /** "ea" for counted items, "lb" (etc.) for weight-priced items. */
  unit?: string | null;
  /** Price actually paid per unit/lb (NetAmount ÷ qty), not shelf/multi-buy price. */
  unit_price?: number;
  /** Amount actually paid for the line (after savings). */
  line_total: number;
  /** Discount applied to this line (BOGO, coupon, sale). */
  saving?: number | null;
  image_url?: string | null;
};

export type ExtractedReceipt = {
  receipt_id?: string | null;
  date: string;
  /** Full purchase timestamp (ISO) when the merchant provides one — used to
   * disambiguate same-day, same-amount matches. `date` stays YYYY-MM-DD. */
  purchased_at?: string | null;
  store?: string | null;
  total: number;
  subtotal?: number | null;
  tax?: number | null;
  items: ReceiptItem[];
};

const client = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = "claude-sonnet-4-6";

const LIST_PROMPT = `You are extracting a list of receipts from a grocery merchant's "purchase history" page.

Return a JSON array. Each entry must have:
- receipt_id (string or null) — order #, receipt #, or any unique identifier visible
- date (YYYY-MM-DD)
- store (string or null)
- total (number) — final amount paid
- subtotal (number or null)
- tax (number or null)
- items: [] (empty — items are on the detail page, not the list)

Output ONLY the JSON array. No prose, no markdown fences.`;

const NAV_PROMPT = `You are looking at the HTML of a merchant's "purchase history" / receipts LIST page.
Each receipt is one row. Clicking a row should open that receipt's detail page (or modal) with line items.

Return a JSON array, one entry per receipt row visible, in the order they appear:
- date (YYYY-MM-DD) — the receipt date shown on the row
- total (number)
- href (string or null) — if the row is wrapped in an <a> with a meaningful href (relative or absolute URL to the detail page), include it. Otherwise null.
- click_selector (string or null) — a CSS selector that, when clicked, opens the detail for this row. Prefer stable attributes (data-*, aria-label, role). Use :nth-of-type as a last resort.

Output ONLY the JSON array.`;

const ITEMS_PROMPT = `You are extracting line items from a SINGLE receipt detail page.

Return ONE JSON object:
- receipt_id (string or null)
- date (YYYY-MM-DD)
- store (string or null)
- total (number)
- subtotal (number or null)
- tax (number or null)
- items: array of { name, qty, unit_price?, line_total }

Rules:
- Real purchase items only. No promos, ads, or "you might like".
- Numbers are plain numbers, not strings.
- Output ONLY the JSON object.`;

export async function extractReceiptsFromHtml(
  html: string
): Promise<ExtractedReceipt[]> {
  return await callJson<ExtractedReceipt[]>(LIST_PROMPT, stripNoise(html), "[", "]");
}

export type NavRow = {
  date: string;
  total: number;
  href: string | null;
  click_selector: string | null;
};

export async function planReceiptNavigation(
  listHtml: string
): Promise<NavRow[]> {
  return await callJson<NavRow[]>(NAV_PROMPT, stripNoise(listHtml), "[", "]");
}

export async function extractReceiptDetailFromHtml(
  detailHtml: string
): Promise<ExtractedReceipt> {
  return await callJson<ExtractedReceipt>(
    ITEMS_PROMPT,
    stripNoise(detailHtml),
    "{",
    "}"
  );
}

async function callJson<T>(
  system: string,
  body: string,
  openChar: "[" | "{",
  closeChar: "]" | "}"
): Promise<T> {
  const trimmed = body.slice(0, 200_000);
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: `HTML:\n\n${trimmed}` }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const start = text.indexOf(openChar);
  const end = text.lastIndexOf(closeChar);
  if (start === -1 || end === -1) {
    throw new Error(`No JSON ${openChar}..${closeChar} in model response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function stripNoise(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ");
}
