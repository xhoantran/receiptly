import Anthropic from "@anthropic-ai/sdk";
// Import the repo functions and the seeded-user constant from their specific
// modules rather than the package barrel: the barrel re-exports session.ts,
// which value-imports Playwright (a server-only native module) and breaks the
// Next bundle. These reads never touch the scraping path.
import {
  listTransactions,
  merchantSummary,
  spendingByItem,
  spendingByCategory,
  canonicalProducts,
  priceHistory,
  savingsSummary,
} from "@receiptly/core/db/repo.js";
import { DEFAULT_USER_ID } from "@receiptly/core/lib/constants.js";

export const runtime = "nodejs";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

const SYSTEM = `You are Sprout, the friendly assistant inside "receiptly" — a personal-finance app that
has fetched the user's SKU-level receipts from merchants. You can see every item on every receipt.

Be warm, concise, and concrete. Use the tools to ground every answer in the user's real data — never
invent numbers. Format money as $X.XX. When you list items, keep it tight. A little personality and the
occasional emoji is welcome, but don't overdo it.

You understand grocery receipt nuance: items can be sold by weight (e.g. "1.04 lb @ $10.99/lb"), and
discounts come from sales, coupons, or BOGO (buy-one-get-one, where one unit is free). When the user
asks about deals or savings, use savings_summary.`;

const tools: Anthropic.Tool[] = [
  {
    name: "query_transactions",
    description: "List the user's bank/card transactions, optionally filtered by merchant or date range.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Exact merchant name, e.g. 'Publix'" },
        from: { type: "string", description: "Start date YYYY-MM-DD" },
        to: { type: "string", description: "End date YYYY-MM-DD" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "merchant_summary",
    description: "Total spend and transaction count grouped by merchant.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "spending_by_item",
    description:
      "Aggregate of every receipt line item: how many times bought, total qty, total spent, avg price. Optionally filter by name substring or date range.",
    input_schema: {
      type: "object",
      properties: {
        like: { type: "string", description: "Case-insensitive substring of the item name, e.g. 'milk'" },
        from: { type: "string" },
        to: { type: "string" },
      },
    },
  },
  {
    name: "price_history",
    description: "Price-over-time for a specific item (matches name substring). Use to spot price changes.",
    input_schema: {
      type: "object",
      properties: { item: { type: "string", description: "Item name substring" } },
      required: ["item"],
    },
  },
  {
    name: "savings_summary",
    description:
      "How much the user saved via sales, coupons, and BOGO deals: total saved, number of discounted items, and the items that saved the most. Optionally filter by date range.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
    },
  },
  {
    name: "spending_by_category",
    description:
      "Spend grouped by canonical category (e.g. 'Groceries › Dairy & Alternatives', 'Personal Care › Skincare') ACROSS ALL MERCHANTS. Use for 'how much on groceries vs personal care' style questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "products",
    description:
      "Canonical products (deduped across merchants) with total spent, times bought, how many different stores it was bought at, and the min–max unit price seen. Use for 'what do I buy', cross-store comparisons, and 'is it cheaper somewhere'. Optionally filter by exact category label.",
    input_schema: {
      type: "object",
      properties: { category: { type: "string" }, limit: { type: "number" } },
    },
  },
];

async function runTool(name: string, input: any): Promise<unknown> {
  switch (name) {
    case "query_transactions":
      return listTransactions(DEFAULT_USER_ID, { merchant: input.merchant, from: input.from, to: input.to, limit: input.limit ?? 50 });
    case "merchant_summary":
      return merchantSummary(DEFAULT_USER_ID);
    case "spending_by_item":
      return (await spendingByItem(DEFAULT_USER_ID, { like: input.like, from: input.from, to: input.to })).slice(0, 40);
    case "price_history":
      return priceHistory(DEFAULT_USER_ID, input.item);
    case "savings_summary":
      return savingsSummary(DEFAULT_USER_ID, { from: input.from, to: input.to });
    case "spending_by_category":
      return spendingByCategory(DEFAULT_USER_ID);
    case "products":
      return (await canonicalProducts(DEFAULT_USER_ID, { category: input.category, limit: input.limit ?? 40 }));
    default:
      return { error: `unknown tool ${name}` };
  }
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Set ANTHROPIC_API_KEY in .env to enable the assistant." });
  }

  const { messages } = (await req.json()) as { messages: { role: "user" | "assistant"; content: string }[] };

  const convo: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const usedTools: string[] = [];

  try {
    // Tool-use loop
    for (let turn = 0; turn < 6; turn++) {
      const res = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM,
        tools,
        messages: convo,
      });

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) {
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        return Response.json({ text, tools: [...new Set(usedTools)] });
      }

      convo.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        usedTools.push(tu.name);
        const out = await runTool(tu.name, tu.input);
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(out).slice(0, 12000),
        });
      }
      convo.push({ role: "user", content: results });
    }
    return Response.json({ text: "I got a bit lost — try rephrasing?", tools: [...new Set(usedTools)] });
  } catch (err: any) {
    return Response.json({ error: `Agent error: ${err?.message ?? String(err)}` });
  }
}
