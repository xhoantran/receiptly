# receiptly — Architecture & Migration Plan

> **Status:** proposal for review · **Date:** 2026-05-29
> **Goal:** evolve receiptly from a local-first CLI tool into a UI-only product
> (web + mobile) for **non-technical users**, where all data processing happens
> on a backend — shipped **open-core**: self-hostable *and* available as a
> managed hosted version, in the style of Supabase.

---

## 1. Why this change

Today receiptly is excellent for developers and wrong for everyone else:

- **It's a CLI.** Setup is `npm install`, `npx playwright install webkit`, editing
  `.env`, then `receiptly init / link / sync / scrape`
  ([`src/cli.ts`](../src/cli.ts)). A non-technical user can't begin.
- **Login is human-in-the-loop and local.** [`src/session.ts:33-89`](../src/session.ts#L33)
  launches a **non-headless** WebKit browser and waits for *you* to sign in, then
  saves `storageState` to a local file.
- **The data layer is single-tenant.** Every query in
  [`src/db/repo.ts`](../src/db/repo.ts) is global — there is no `user_id` anywhere
  in [`src/db/schema.ts`](../src/db/schema.ts). The web app imports those repo
  functions and reads the local SQLite file directly
  ([`web/lib/data.ts:5-21`](../web/lib/data.ts#L5)).

The target users are non-technical, so the product must be **UI-only (web +
native mobile)** with **processing on the backend**.

### What we keep
- The **connector contract** is clean and survives unchanged:
  `matches / loginUrl / isLoggedIn / fetchReceipts(page)`
  ([`src/connectors/types.ts`](../src/connectors/types.ts)).
- **Receipt semantics** (weight pricing, BOGO, sales, savings), the **canonical
  product** model, **Plaid** sync, the **ingest/match** pipeline, and **Sprout**
  (the agent) are all reusable as a server-side core.
- TypeScript end-to-end; Drizzle's query builder is dialect-agnostic, so most of
  `repo.ts` ports to Postgres untouched (the schema file already says so).

### The honest trade-offs
Moving processing server-side **retires the current "100% local, no server"
promise**. We address that two ways: (1) the **self-host** build keeps a real
privacy story — your data, your infra; (2) the hosted build is explicit about
encryption and what we store. See [§9 Security](#9-security--privacy) and
[§10 Legal](#10-legal--merchant-tos).

---

## 2. Guiding principles (open core, Supabase-style)

1. **Portable, vendor-neutral core.** The product runs on **plain Postgres + S3-
   compatible storage + a job queue**. No managed service is *required*. Supabase,
   Neon, RDS, Fly Postgres, or a local Docker Postgres are all valid backends —
   Supabase is *a* deployment target, not the framework.
2. **One codebase, two distributions.** Self-host (`docker compose up`) and the
   hosted service run the **same** application images. Hosted adds a thin,
   separate **control plane** (billing, usage metering, managed secrets, autoscale)
   that the OSS core never depends on.
3. **The backend is the product.** Web and mobile are thin clients over one
   authenticated API. No business logic in the clients.
4. **Secrets are encrypted at rest, always.** Bank tokens and merchant sessions
   are envelope-encrypted; the encryption provider is swappable (local key for
   self-host, KMS for hosted).

---

## 3. Target topology (monorepo)

```
receiptly/
├── packages/
│   ├── core/        the engine: connectors, db (Drizzle/Postgres), plaid,
│   │                ingest, match, products, agent tools, crypto, queue iface
│   └── client/      one typed API SDK + platform-agnostic view helpers
│                    (money/date/chip/emoji — moved out of web/lib/data.ts)
├── apps/
│   ├── api/         HTTP API + auth + endpoints  (web AND mobile call this)
│   ├── worker/      Playwright browser workers (the scraping farm)
│   ├── web/         Next.js 15 — refactored to call the API, + auth + responsive
│   └── mobile/      Expo / React Native — same SDK
├── infra/
│   ├── compose/     docker-compose for self-host
│   └── cloud/       hosted-only control plane (billing/metering/KMS) — separate
└── docs/
```

Tooling: **pnpm workspaces + Turborepo**. Today's `src/` becomes `packages/core`;
today's `web/` becomes `apps/web`.

```
                 ┌──────────┐        ┌──────────┐
                 │  apps/web│        │apps/mobile│
                 └────┬─────┘        └────┬─────┘
                      │  packages/client (typed SDK + SSE)
                      └──────────┬────────┘
                                 ▼
                        ┌──────────────────┐    enqueue     ┌──────────────┐
                        │     apps/api      │ ─────────────▶ │  job queue   │
                        │ auth · plaid ·    │                │  (pg-boss)   │
                        │ agent · reads     │ ◀───────────── └──────┬───────┘
                        └─────────┬─────────┘     status            │ consume
                                  │                                 ▼
                                  │                         ┌───────────────┐
                                  ▼                         │  apps/worker  │
                           ┌─────────────┐                  │  Playwright + │
                           │  Postgres   │ ◀──── receipts ──│ browser-provider│
                           │  (+ RLS)    │                  └───────┬───────┘
                           └─────────────┘                          │ images
                                  ▲                                 ▼
                                  └───────────────────────── object storage (S3/R2/MinIO)
```

---

## 4. Tech choices (and why)

| Concern | Choice | Why / portability note |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Standard, fast, shared TS types |
| DB | **Postgres** + Drizzle (pg dialect) | Schema comment already targets it; runs anywhere incl. Supabase |
| Migrations | `drizzle-kit generate` (versioned SQL) | Safe for prod; `push` was dev-only |
| Auth | **Better Auth** (DB-backed, TS-native) | Stored in *our* Postgres → no lock-in; email+OAuth+sessions |
| API | **Hono** + typed RPC client | Tiny, portable (Node/Bun/edge), great DX |
| Realtime/stream | **SSE** for the agent + job status | Works on web and React Native |
| Job queue | **pg-boss** (Postgres-backed) | Self-host needs *only* Postgres; behind a `JobQueue` interface so hosted can swap to BullMQ/SQS |
| Browser | **Playwright**, behind a `BrowserProvider` iface | `local` (self-host) vs `remote` CDP (Browserbase/Steel/Browserless) for hosted scale + anti-bot |
| Secrets | Envelope encryption, swappable provider | `local` (libsodium + key from env/file) vs `kms` (AWS/GCP) for hosted |
| Object storage | S3-compatible | R2/S3 hosted · MinIO or local-disk driver self-host |
| Web | Next.js 15 (kept) | Reuse existing UI; make it responsive |
| Mobile | Expo + Expo Router | Plaid via `react-native-plaid-link-sdk`; login via `react-native-webview` |
| License | core **MIT** (unchanged) · control plane commercial | Open-core split |

---

## 5. Data model — multi-tenant

Add a tenant boundary and split "registry vs per-user state".

- **Auth tables** (managed by Better Auth): `user`, `session`, `account`, `verification`.
- **Add `user_id`** (FK → `user.id`) to: `plaid_items`, `transactions`,
  `receipts`, `receipt_items`, `matches`. Update composite indexes to lead with `user_id`.
- **Split the `connectors` table.** Today it mixes the *registry* (key, displayName,
  mode) with per-user *status*. The registry lives in **code** (`packages/core/connectors`).
  Per-user state becomes:
  - `merchant_connections(user_id, connector_key, status, last_sync_at, last_error)`
  - `merchant_sessions(user_id, connector_key, encrypted_state, expires_at, status)` — encrypted `storageState`.
- **Encrypt** `plaid_items.access_token` and `merchant_sessions.encrypted_state`.
- **Canonical catalog stays global.** `products` + `product_links` are shared
  across users — they hold no PII (just product names/brands/images/categories),
  and sharing cuts LLM categorization calls and image fetches dramatically.
  `receipt_items.product_id` references the global catalog. *(A privacy-maximalist
  self-host can flip a `PRODUCTS_PER_TENANT` flag to scope them per user.)*
- **RLS (defense-in-depth).** When on a Postgres that supports it, enable row-level
  security keyed on `user_id`; the API also scopes every query. Both layers, not one.

`repo.ts` changes: thread `userId` through every function (`listTransactions(userId, …)`,
etc.). The Drizzle builder calls themselves barely change — we add `eq(table.userId, userId)`.

---

## 6. The hard part — server-side merchant login & scraping

The current flow needs a human at the browser. Server-side, the user isn't there.

**Solution: remote interactive login → encrypted session → headless replay.**

```
1. User taps "Connect Publix" (web/mobile).
2. API enqueues a `login` job. Worker launches a browser via BrowserProvider,
   opens connector.loginUrl, and returns a LIVE-VIEW URL.
3. Client shows the live browser (web iframe / mobile webview). The user signs in,
   including MFA / captcha — once.
4. Worker polls connector.isLoggedIn(page); on success it captures storageState,
   encrypts it, writes merchant_sessions, and tears the browser down.
5. API enqueues a `scrape` job (also on a schedule + on Plaid webhook). A HEADLESS
   worker decrypts the session, runs connector.fetchReceipts(page), then the
   existing ingest → match → resolve pipeline; product images are cached to object storage.
6. On session expiry → status `needs_relogin` → notify the user to reconnect.
```

This **preserves the `Connector` interface** — `loginUrl` + `isLoggedIn` +
`fetchReceipts(page)` are exactly what `session.ts` already uses; only the
*orchestration* moves from "local headful + wait for human" to "worker + remote
live-view". `withSession()`'s 5-minute interactive wait generalizes into the job's
live-view polling loop.

Why remote live-view over storing username/password: it handles **MFA and captcha**,
keeps us out of holding raw merchant credentials, and matches how the user already
logs in today — just streamed.

**Browser provider interface** (so self-host and hosted differ only in config):
```ts
interface BrowserProvider {
  startLoginSession(connector): Promise<{ page, liveViewUrl, sessionId }>
  runHeadless<T>(connector, encryptedState, fn): Promise<T>
}
// local  → playwright.webkit.launch() + (self-host) noVNC/CDP live-view
// remote → connect over CDP to Browserbase/Steel/Browserless (hosted: scale + anti-bot)
```

---

## 7. Plaid, server-side & per-user

- `createLinkToken(userId)` already takes a user ([`src/lib/plaid.ts:26`](../src/lib/plaid.ts#L26)).
- Endpoints (all authenticated): `POST /plaid/link-token`, `POST /plaid/exchange`
  (store the **encrypted** access token under the user), `POST /plaid/webhook`
  (→ enqueue a per-item sync job). Cursor is stored per `plaid_item`.
- **Delete** the local Plaid-Link express page ([`src/server.ts`](../src/server.ts) +
  [`src/link.html`](../src/link.html)); web uses Plaid Link JS, mobile uses
  `react-native-plaid-link-sdk`.

---

## 8. The agent (Sprout) & the API surface

- Move [`web/app/api/chat/route.ts`](../web/app/api/chat/route.ts) into `apps/api`.
  Inject `userId` into `runTool` so every tool query is user-scoped. **Stream** the
  response over SSE (works on web + RN). Add per-user rate limits + a cost guard (hosted).
- Reads (`listTransactions`, `merchantSummary`, `spendingByItem`, …) become
  authenticated REST/RPC endpoints. `web/lib/data.ts` stops importing `repo.ts` and
  calls the typed client instead; the pure view helpers (`money`, `shortDate`,
  `chipFor`, `emojiFor`) move to `packages/client` so mobile reuses them.
- **CLI survives** as a thin API client + self-host admin tool (run migrations,
  create the first user) — power users keep it; it no longer *is* the product.

---

## 9. Security & privacy

Holding bank tokens **and** merchant sessions server-side raises the bar:

- **Encryption at rest** for `plaid_items.access_token` and `merchant_sessions`
  (envelope encryption; per-tenant data keys; KMS-wrapped in hosted).
- **Isolation**: every query scoped by `user_id` in the API **and** RLS in Postgres.
- **Secrets**: provider keys (Plaid, Anthropic) in a secrets manager (hosted) / env
  (self-host); never in the DB.
- **Worker hygiene**: ephemeral browser contexts, no shared cookies between users,
  scrub artifacts, network egress controls.
- **Audit log** of session use and scrapes.
- **Privacy story**: self-host = your infra, your data. Hosted = documented data
  handling + encryption + deletion. The README's "no cloud" copy gets rewritten to
  this two-mode reality (self-host preserves the original promise).

---

## 10. Legal & merchant ToS

Automated access to merchant accounts on a user's behalf carries **real ToS/legal
exposure**, and it is materially higher for the **hosted** service at scale than for
a single self-hoster. This is the biggest non-engineering risk. Mitigations to
decide before hosted launch:

- Per-merchant ToS review; allowlist connectors that are acceptable for hosted.
- Explicit **user authorization** ("you authorize receiptly to access X on your
  behalf") + clear data-use disclosure.
- Conservative rate limiting and human-like pacing; respect robots/abuse signals.
- Self-host ships *all* connectors; hosted may ship a vetted subset.

---

## 11. Phased migration plan

Each phase is independently shippable and ends in a usable state.

### Phase 0 — Foundations *(no user-visible change)*
- pnpm + Turborepo monorepo; move `src/` → `packages/core`, `web/` → `apps/web`.
- Postgres + Drizzle pg dialect; `drizzle-kit generate` migrations.
- Add `user_id` everywhere; split `connectors` → `merchant_connections` /
  `merchant_sessions`; add encryption columns.
- Better Auth tables + `packages/core/crypto` (local provider).
- **Done when:** existing flows work for one seeded user on Postgres; typecheck green.

### Phase 1 — Hosted read path (web)
- `apps/api` (Hono) with Better Auth; authenticated endpoints for Plaid
  link/exchange/sync, all reads, and the Sprout agent (SSE).
- `apps/web`: login/signup, Plaid Link, **responsive** dashboard (the 3-column
  layout that broke the screenshot now stacks on mobile), calls the API only.
- **Done when:** a non-technical user signs up, links a bank, sees transactions,
  and chats with Sprout — entirely in the browser.

### Phase 2 — Server-side scraping
- pg-boss queue + `apps/worker` + `BrowserProvider` (local).
- Remote interactive login (live-view) + encrypted sessions + scheduled scrapes +
  image caching to object storage.
- **Done when:** "Connect a merchant" works end-to-end from the UI and receipts
  appear automatically.

### Phase 3 — Mobile
- `apps/mobile` (Expo Router) on `packages/client`; Plaid RN SDK; merchant login via
  in-app webview live-view; push notifications ("receipts ready", price drops).

### Phase 4 — Open-core packaging
- `infra/compose` one-command self-host (Postgres + API + worker + web + MinIO).
- Hosted control plane (billing, usage metering, KMS, managed browser, autoscale)
  in `infra/cloud`, isolated from the core. License split. Docs.

---

## 12. Open questions

1. **Accounts**: single-user accounts now, teams/orgs later? (Plan assumes single-user.)
2. **Hosted browser provider**: Browserbase vs Steel vs self-run Browserless?
3. **KMS** for hosted: AWS KMS / GCP KMS / Tink?
4. **Hosted connector allowlist** pending ToS review (§10).
5. **Pricing/metering** model for hosted — out of scope until Phase 4.
6. Keep the **interactive desktop** path at all, or fully retire local headful login?

---

*This document is the plan of record. Implementation starts at Phase 0 once approved.*
