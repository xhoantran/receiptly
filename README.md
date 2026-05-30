<div align="center">

# 🧾 receiptly

### Your bank says **“$62.02 at Publix.”**<br/>receiptly says **“oat milk, cocoa, a picanha steak — and the cat food was free.”**

**Item-level receipts from any merchant — for everyone.**<br/>
No CSV exports, no spreadsheets, no developer tools. Connect, and your receipts itemize themselves.

[![License: MIT](https://img.shields.io/badge/License-MIT-0fa968.svg)](#-license)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](#-built-with)
[![Open-core](https://img.shields.io/badge/open--core-self--host%20or%20hosted-0fa968.svg)](#-run-it-yourself)
[![Merchant login: on-device](https://img.shields.io/badge/merchant%20login-on--device-7c6bf0.svg)](#-the-magic)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-7c6bf0.svg)](#-add-a-merchant)

</div>

---

## ✨ The magic

Bank aggregators (Plaid, Teller, MX) stop at the **transaction**: merchant, amount, date. They never see the **line items** — because that data lives on the *merchant’s* side, not the bank’s.

So your finance app knows you spent `$62.02 at PUBLIX #1234`. It has no idea you bought oat milk, that the steak was $10.99/lb on sale, or that the second bag of cat food was a buy-one-get-one freebie.

**receiptly closes that loop.** It links each charge to the *real itemized receipt* the merchant has, reads it correctly — SKUs, weights, savings, product photos — and hands the whole story to an AI agent that actually knows what you buy.

> The hard part is that merchants hide receipts behind bot-walls (Akamai & friends) that block servers cold. **receiptly doesn’t fight them — it signs in from your own device, like you would.** Real device, real you. The receipts just come home. 🪄

---

## 🪄 How it feels

Three taps, then it runs itself:

1. **Connect your bank.** Transactions flow in (Plaid).
2. **Connect a merchant.** Sign in once, on your own device — a real browser, so the bot-walls wave you through.
3. **Watch it itemize.** Receipts match themselves to your charges. Then just *ask*:

> 🌱 *“What did I buy at Publix?”* · *“How much have I saved with deals?”* · *“Where’s my milk cheapest?”*

---

## 📸 A look

```
┌─────────────────────────────────────────────────────────┐
│  Welcome back 👋                                          │
│  Here's what you've been buying                           │
│                                                           │
│  Total spend   Saved w/ deals   Items tracked   Match     │
│  $12,640.24       $47.58             62           87%     │
│                                                           │
│  🟢 Publix · May 17                          $49.32  →    │
│     1.04 lb  Top Sirloin Cap (Picanha)    sale −$3.64     │
│     1×       Reveal Cat Food (Fish)        BOGO    FREE   │
└─────────────────────────────────────────────────────────┘
```

---

## 🛍️ Supported merchants

Logos and support status live in one catalog (`apps/web/lib/merchants.ts`) — adding a merchant lights it up everywhere automatically.

**✅ Live today**
&nbsp;&nbsp;**Publix**

**🧪 In beta** — on-device capture, this release
&nbsp;&nbsp;**Amazon** · **Costco**

**🌱 On the roadmap** — want one bumped up? Open an issue or a PR.
&nbsp;&nbsp;Starbucks · Target · Walmart · Kroger · Whole Foods · Trader Joe’s · ALDI · Sam’s Club · H-E-B · CVS · Walgreens · Instacart · DoorDash · Uber Eats · Chipotle · The Home Depot · Best Buy

---

## 🏗️ How it works

```
        your bank                              your device
     ┌─────────────┐                    ┌────────────────────┐
     │    Plaid    │                    │  sign in once  →    │
     │ transactions│                    │  receipts captured  │
     └──────┬──────┘                    └──────────┬──────────┘
            │ what · when · how much               │ what exactly
            │                                       │ (SKUs, $, weight, savings)
            ▼                                       ▼
        ┌───────────────────────────────────────────────────┐
        │                 receiptly backend                  │
        │   Postgres · encrypt-at-rest · match receipts ↔    │
        │   charges by amount + date · resolve products      │
        └───────────────────────────┬───────────────────────┘
                                     ▼
                         ┌───────────────────────┐
                         │   Next.js web · UI     │
                         │      + Sprout 🌱        │  ◀── Claude tool-use
                         └───────────────────────┘
```

1. **Plaid** syncs transactions (the *what / when / how-much*).
2. The **native app** (desktop or mobile) signs into the merchant **on your device** and captures the *itemized* receipt — the *what-exactly*. Two capture modes: `json` for merchants with a clean receipt API (Publix), `html` + Claude for the ones without (Amazon, Costco).
3. A two-pass **matcher** links each receipt to its transaction by amount + date.
4. The **Next.js app** shows it beautifully; **Sprout** answers questions over it with Claude.

---

## 🚀 Run it yourself

receiptly is **open-core** — self-host the whole thing today, or (soon) use the hosted version with zero setup.

```bash
# 1. Clone + install
git clone <your-fork> receiptly && cd receiptly
pnpm install

# 2. Start Postgres (or bring your own)
docker compose -f infra/compose/docker-compose.yml up -d

# 3. Configure — copy and fill in keys
cp .env.example .env
#   DATABASE_URL              → the Postgres above
#   RECEIPTLY_ENCRYPTION_KEY  → openssl rand -base64 32   (encrypts tokens at rest)
#   BETTER_AUTH_SECRET        → openssl rand -base64 32
#   PLAID_CLIENT_ID / SECRET  → dashboard.plaid.com  (free tier)
#   ANTHROPIC_API_KEY         → console.anthropic.com

# 4. Create the schema + seed
pnpm -C packages/core db:migrate
pnpm -C packages/core db:seed

# 5. Launch the app
pnpm web                      # → http://localhost:4000
```

Then, in the app:

1. **Connect your bank** — transactions flow in.
2. **Connect a merchant** — for the on-device sign-in, launch the desktop app and click **Connect & fetch**:
   ```bash
   cd apps/desktop && npm install   # first run only
   npm start                        # the dashboard opens as a native window
   ```
3. **Done.** Your receipts itemize themselves, match to your charges, and Sprout is ready.

---

## 🧩 Add a merchant

The whole mission is the long tail — so adding a merchant is small and mostly config:

1. **Catalog it** — one line in `apps/web/lib/merchants.ts` (the logo comes free from the domain).
2. **Add a connector** — `packages/core/src/connectors/<merchant>.ts` with a `matches(tx)` rule (steal the shape from `publix.ts`).
3. **Pick a capture mode:**
   - **`json`** — the merchant has a clean receipt API → wrap it, normalize the payload.
   - **`html`** — no API → the on-device app grabs the receipt’s text and Claude turns it into structured items.
4. **Wire on-device capture** — an `HTML_SPECS` entry + a scraper in `apps/desktop`, and add the key to `NATIVE_MERCHANTS`.

> 🔍 To reverse-engineer a merchant’s traffic while you click around, the dev tool is `pnpm receiptly discover <merchant>`.

---

## 🔐 Privacy

receiptly is built so the sensitive parts stay yours:

- **Merchant sign-in happens on *your* device**, in a real browser. Your merchant password is entered by you and never relayed to a server.
- **Bank tokens & merchant sessions are encrypted at rest** (AES-256-GCM).
- The only outbound calls are to *your* configured **Plaid** and **Anthropic** keys.
- **Self-host** the entire stack, or use the hosted version when it lands — your choice, same code.

---

## 🛠️ Built with

**TypeScript** end-to-end · **Next.js 15** + **Tailwind v4** (UI) · **Postgres** + **Drizzle ORM** · **Plaid** (transactions) · **Claude** (Sprout) · **Electron** (desktop) + **Expo** (mobile) for on-device capture · **pnpm** + **Turborepo** · **Fraunces / Hanken Grotesk / Spline Mono** (type).

---

## 🗺️ Roadmap

- [x] Plaid sync + transactions
- [x] On-device merchant capture (beats Akamai-class bot-walls) — desktop + mobile
- [x] Publix · Amazon · Costco
- [x] Receipt semantics: weight pricing, BOGO, sales, savings
- [x] Product images + a unified, cross-merchant product catalog
- [x] Sprout — the AI spending agent
- [x] Postgres + multi-tenant foundation (open-core)
- [ ] **Hosted version** — one-click, no setup
- [ ] **More merchants** — the long tail (see the list above)
- [ ] Price-drop & deal alerts across merchants
- [ ] Mobile app polish → app stores
- [ ] MCP server — expose your receipts to any agent

---

## 🤝 Contributing

Got a merchant you wish receiptly supported? Catalog it, build the connector, open a PR. Every merchant added makes Sprout smarter for everyone. 🌱

## 📄 License

MIT — do what you want, just don’t sell people’s receipts.
