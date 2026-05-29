<div align="center">

# 🧾 receiptly

### Plaid tells you that you spent **$62.02 at Publix**.<br/>receiptly tells you it was **oat milk, cocoa, a picanha steak — and the cat food was free.**

**Open-source, local-first item-level receipts from any merchant — with an AI agent on top.**

[![License: MIT](https://img.shields.io/badge/License-MIT-0fa968.svg)](#-license)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](#-tech)
[![Local-first](https://img.shields.io/badge/data-100%25%20local-0fa968.svg)](#-privacy)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-7c6bf0.svg)](#-add-a-merchant-in-an-afternoon)

</div>

---

## The gap

Bank aggregators (Plaid, Teller, MX) stop at the **transaction**: merchant, amount, date. They never see the **line items** — because that data lives on the *merchant's* side, not the bank's.

So your finance app knows you spent `$62.02 at PUBLIX #1234`. It has no idea you bought oat milk, that the steak was $10.99/lb on sale, or that the second bag of cat food was a buy-one-get-one freebie.

**receiptly closes that loop.** It links the transaction to the *real itemized receipt* the merchant has, normalizes it, and hands the whole thing — SKUs, weights, savings, product photos — to an AI agent that actually knows what you buy.

> Think of it as **open-source, local-first, item-level receipts built for the long tail of merchants** nobody else bothers to integrate.

---

## ✨ What you get

| | |
|---|---|
| 🔌 **Plug-in connectors** | One file per merchant. `Publix` ships today; `Amazon`, `Costco`, `Starbucks` are next. |
| 🛰️ **Two connector modes** | `api` for officially-supported merchants, `browser` for the long tail we reverse-engineer with Playwright. |
| 🧠 **Dynamic discovery** | `npm run discover <merchant>` watches the site's own network calls so you build a connector from *what the app actually does* — not guesswork. |
| 🧾 **True receipt semantics** | Weight-priced items (`1.04 lb @ $10.99/lb`), BOGO freebies, coupons, and sales — interpreted correctly, not flattened. |
| 🖼️ **Product images** | Real photos pulled straight from the merchant, with a graceful pastel fallback when one's missing. |
| ✨ **Sprout, your agent** | "What did I buy at Publix?" · "How much have I saved with deals?" · "Find my milk purchases." Grounded in your real data, never invented. |
| 🔐 **100% local** | Bank tokens, merchant sessions, and receipts live in a SQLite file on *your* machine. Nothing is hosted. |

---

## 📸 A look

```
┌─────────────────────────────────────────────────────────┐
│  Welcome back 👋                                          │
│  Here's what you've been buying                           │
│                                                           │
│  Total spend   Saved w/ deals   Items tracked   Match     │
│  $12,640.24       $47.58             62           21%     │
│                                                           │
│  🧾 Publix · May 17                          $49.32  →    │
│     1.04 lb  Top Sirloin Cap (Picanha)   sale −$3.64      │
│     1×       Reveal Cat Food (Fish)       BOGO     FREE   │
└─────────────────────────────────────────────────────────┘
```

---

## 🏗️ How it works

```
  ┌──────────┐     transactions      ┌─────────────┐
  │  Plaid   │ ───────────────────▶  │   SQLite    │
  └──────────┘   (merchant/amount)   │  (Drizzle)  │
                                     └──────┬──────┘
  ┌────────────────────────┐               │  match by
  │   Merchant connectors   │  itemized     │  amount + date
  │  ┌──────┐  ┌─────────┐  │  receipts     │
  │  │ api  │  │ browser │  │ ─────────────▶│
  │  └──────┘  └─────────┘  │  (SKUs, $,    │
  │   Playwright + WebKit   │   weight,     │
  └────────────────────────┘   savings)     ▼
                                     ┌─────────────┐
                                     │  Next.js UI │
                                     │  + Sprout 🌱│  ◀── Claude tool-use
                                     └─────────────┘
```

1. **Plaid** syncs transactions (the *what/when/how-much*).
2. A **connector** signs into the merchant (locally, in a real browser) and fetches the *itemized* receipt — the *what-exactly*.
3. A two-pass **matcher** links each receipt to its transaction by amount + date.
4. The **Next.js app** shows it beautifully; **Sprout** answers questions over it with Claude tool-use.

---

## 🚀 Quickstart

```bash
# 1. Install
npm install
npx playwright install webkit

# 2. Configure — copy and fill in keys
cp .env.example .env
#   PLAID_CLIENT_ID / PLAID_SECRET  → https://dashboard.plaid.com (free tier)
#   ANTHROPIC_API_KEY               → https://console.anthropic.com

# 3. Set up the local database + connectors
npm run db:push
npx receiptly init

# 4. Link a bank, pull transactions
npx receiptly link        # opens the Plaid Link UI → connect your bank
npx receiptly sync        # pull transactions into the local DB

# 5. Fetch itemized receipts for a merchant — one command
npx receiptly scrape publix
#   opens a browser, signs you in if needed (saved after the first time),
#   then fetches receipts, matches them to your charges, and categorizes.
#   Next time, `npx receiptly scrape` refreshes every merchant you're signed into.

# 6. Launch the app
npm run web               # http://localhost:4000
```

> Plaid's free tier and a real bank link are all you need to try it. Your data never leaves your laptop.

## 📁 Project structure

Two intentional pieces sharing one local SQLite database and the same TypeScript core:

```
receiptly/
├── src/                  the engine + CLI  (everything non-UI)
│   ├── cli.ts            ← `receiptly` — the single command-line interface
│   ├── connectors/       one file per merchant (publix, amazon, …) + registry
│   ├── session.ts        login once, reuse the saved session to scrape
│   ├── discover.ts       capture a merchant's traffic to build a connector
│   ├── db/               Drizzle schema + repository (SQLite → Postgres-ready)
│   ├── lib/              plaid, products (canonical), ingest, extract, taxonomy
│   └── server.ts         tiny Plaid-Link page (the only browser-redirect bit)
├── web/                  the UI  (Next.js 15) — reads the same core + DB
│   ├── app/              dashboard, transactions, items, merchants, agent API
│   └── components/
└── data/                 your local database, sessions, captures (git-ignored)
```

The engine never imports the UI; the UI imports the engine. One database file (`data/receiptly.db`) is the single source of truth.

### The `receiptly` CLI

```
receiptly init                 set up the database + seed connectors
receiptly link                 open the Plaid Link UI to connect a bank
receiptly sync                 pull new transactions from Plaid
receiptly scrape <merchant…>   fetch receipts (signs you in automatically if needed)
receiptly login <merchant>     pre-authenticate a merchant (optional)
receiptly discover <merchant>  capture a merchant's traffic to build a connector
receiptly merchants            list connectors + session status
receiptly tx                   transactions grouped by merchant
receiptly resolve [--force]    (re)resolve items into canonical products
```

---

## 🧩 Add a merchant in an afternoon

The whole point: adding the long tail should be *easy*. The workflow is built in.

```bash
# 1. Watch the merchant's own network traffic while you click around
npm run discover costco
#    → signs you in, you browse your orders, press Enter
#    → every API/HTML response saved to data/discovery/costco-<ts>/

# 2. Inspect what you captured
cat data/discovery/costco-*/_index.json    # endpoints + headers

# 3. Write src/connectors/costco.ts
#    implement matches(tx) + fetchReceipts(), normalize into ExtractedReceipt
#    (steal the shape from src/connectors/publix.ts)

# 4. Register it in src/connectors/index.ts and run it
npm run scrape costco
```

A connector is one file implementing a tiny interface:

```ts
export const costcoConnector: Connector = {
  key: "costco",
  displayName: "Costco",
  mode: "browser",                       // or "api"
  matches: (tx) => /costco/i.test(tx.merchant),
  fetchReceipts: async () => [ /* ExtractedReceipt[] */ ],
};
```

If the merchant serves JSON, you parse it. If it's HTML-only, hand it to `extract.ts` and Claude turns it into structured items. Either way, the browser session, stealth, and storage are handled for you.

---

## 🔐 Privacy

receiptly is **local-first by design**:

- Bank access tokens, merchant cookies, and every receipt sit in `data/receiptly.db` on your machine.
- Connectors run a real browser **on your computer** — credentials are entered by you, sessions stored locally, never relayed.
- The only outbound calls are to *your* configured Plaid and Anthropic keys. There is no receiptly server. There is no receiptly cloud.

---

## 🛠️ Tech

**TypeScript** end-to-end · **Plaid** (transactions) · **Playwright + WebKit** (connectors) · **Drizzle ORM** on **SQLite** (Postgres-ready) · **Next.js 15** + **Tailwind v4** (UI) · **Claude** (the agent) · **Fraunces / Hanken Grotesk / Spline Mono** (type).

---

## 🗺️ Roadmap

- [x] Plaid sync + local store
- [x] Publix connector (browser-mode, JSON API)
- [x] Receipt semantics: weight pricing, BOGO, sales, savings
- [x] Product images
- [x] Sprout — the AI spending agent
- [ ] Amazon & Costco connectors
- [ ] Local image caching
- [ ] Price-drop & deal alerts across merchants
- [ ] MCP server wrapper (expose connectors to any agent)
- [ ] Postgres + multi-user mode

---

## 🤝 Contributing

Got a merchant you wish receiptly supported? `npm run discover <it>`, build the connector, open a PR. The long tail is the whole mission — every merchant added makes the agent smarter for everyone.

## 📄 License

MIT — do what you want, just don't sell people's receipts. 🌱
