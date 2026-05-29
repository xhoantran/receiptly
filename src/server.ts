/**
 * Plaid Link UI server — the one piece that needs a browser + redirect flow.
 * Linking a bank exchanges a public token and stores the item in the DB.
 * Everything else (sync, scrape) is the `receiptly` CLI.
 */
import express from "express";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./lib/config.js";
import { createLinkToken, exchangePublicToken } from "./lib/plaid.js";
import { savePlaidItem } from "./db/repo.js";
import { syncAll } from "./lib/plaid-sync.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

app.get("/", async (_req, res) => {
  const html = await readFile(resolve(here, "link.html"), "utf8");
  res.type("html").send(html);
});

app.post("/api/create_link_token", async (_req, res) => {
  try {
    res.json({ link_token: await createLinkToken("receiptly-user") });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/exchange_public_token", async (req, res) => {
  try {
    const { public_token } = req.body as { public_token: string };
    const ex = await exchangePublicToken(public_token);
    await savePlaidItem({ itemId: ex.item_id, accessToken: ex.access_token });
    res.json({ ok: true, item_id: ex.item_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/sync", async (_req, res) => {
  try {
    const { items, added } = await syncAll();
    if (items === 0) return res.status(400).json({ error: "no banks linked yet — link one above first" });
    res.json({ items, added });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(config.port, () => {
  console.log(`receiptly Plaid Link → http://localhost:${config.port}`);
  console.log(`After linking:  curl -X POST http://localhost:${config.port}/api/sync   (or: receiptly sync)`);
});
