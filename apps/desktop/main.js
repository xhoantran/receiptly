// receiptly desktop (Electron).
//
// The MAIN window IS the dashboard (the Next web app). The dashboard's
// "Connect & fetch" button detects the desktop bridge (preload → window.
// receiptlyDesktop) and triggers connect-publix here.
//
// connect-publix opens a real local Chromium where the user logs into Publix.
// Because it's a real browser on the user's machine (real residential IP, real
// OS input, real engine, plain Chrome UA), Akamai accepts it — the same reason
// the on-device mobile WebView works. We capture the receipt API responses via
// an in-page injection (publix-preload.js, no CDP) and POST them to the backend.
const { app, BrowserWindow, ipcMain, session } = require("electron");
const path = require("path");
const fs = require("fs");

// Chromium's sandbox fails to initialize for an unsigned/dev Electron in some
// environments ("Failed to initialize sandbox" → blank renderers). Disabling it
// is invisible to web pages, so it doesn't affect the Akamai bypass.
app.commandLine.appendSwitch("no-sandbox");

const PUBLIX_URL = "https://www.publix.com/account/purchases?nav=account_sidebar_button";
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// The desktop app is a native shell over your receiptly web app (the same pattern
// Slack/Discord/Notion use to wrap their web UI). It loads the dashboard from YOUR
// server — chosen once on the Connect screen and persisted to userData/config.json,
// overridable via the RECEIPTLY_API_URL env var. Its own value-add is the on-device
// merchant login below, which a plain browser can't do.
const DEFAULT_API_URL = "http://localhost:4000";
function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { return {}; }
}
function writeConfig(patch) {
  try { fs.writeFileSync(configPath(), JSON.stringify({ ...readConfig(), ...patch }, null, 2)); } catch (e) { /* best effort */ }
}
function getApiUrl() {
  return (process.env.RECEIPTLY_API_URL || readConfig().apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
}

const LOGO_SVG = `<svg viewBox="0 0 512 512" width="72" height="72"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#15bd79"/><stop offset="1" stop-color="#0a7d4d"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="124" fill="url(#lg)"/><path d="M181,174 Q181,150 205,150 H307 Q331,150 331,174 V345 L306,363 281,345 256,363 231,345 206,363 181,345 Z" fill="#faf6ee"/><g stroke="#9bd9be" stroke-width="13" stroke-linecap="round"><line x1="205" y1="208" x2="307" y2="208"/><line x1="205" y1="246" x2="281" y2="246"/></g><path d="M256,150 V120" stroke="#faf6ee" stroke-width="11" stroke-linecap="round"/><path d="M256,134 C235,135 221,118 231,99 C252,104 258,119 256,134 Z" fill="#faf6ee"/><path d="M256,134 C277,135 291,118 281,99 C260,104 254,119 256,134 Z" fill="#faf6ee"/></svg>`;

let mainWin = null;

function loadDashboard() {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.loadURL(getApiUrl()).catch((e) => showConnect(e && e.message));
}

// Shown when the dashboard URL can't be reached — a friendly "point me at your
// receiptly" screen (with a saved, editable URL) instead of a raw error.
function showConnect(reason) {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(connectScreen(getApiUrl(), reason)));
}

function connectScreen(url, reason) {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px/1.5 -apple-system,system-ui,sans-serif;color:#211f1a;background:#faf6ee;height:100vh;display:grid;place-items:center">
  <div style="max-width:460px;text-align:center;padding:32px">
    <div style="margin:0 auto 18px;width:72px;height:72px">${LOGO_SVG}</div>
    <h1 style="font-family:Georgia,serif;font-weight:600;font-size:26px;margin:0 0 6px">Connect to your receiptly</h1>
    <p style="color:#8a8475;margin:0 0 22px">This app shows the dashboard from your receiptly server and adds on-device merchant login. Point it at your instance.</p>
    <input id="u" value="${url}" placeholder="${DEFAULT_API_URL}" spellcheck="false" autocapitalize="off" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #e2d9c8;border-radius:12px;font:14px ui-monospace,monospace;background:#fff;color:#211f1a"/>
    <button onclick="go()" style="margin-top:12px;width:100%;padding:12px;border:0;border-radius:12px;background:#0a7d4d;color:#fff;font-weight:600;font-size:15px;cursor:pointer">Connect</button>
    ${reason ? `<p style="color:#b3261e;font-size:12.5px;margin-top:16px">Couldn't reach it (${String(reason).slice(0, 90)}). Is the server running?</p>` : ""}
    <p style="color:#a59d8c;font-size:12.5px;margin-top:18px">Running it locally? Start it with <code style="background:#f3ecdf;padding:1px 5px;border-radius:5px">pnpm web</code> on this Mac.</p>
  </div>
  <script>
    function go(){ var v=(document.getElementById('u').value||'').trim(); if(v&&window.receiptlyDesktop&&window.receiptlyDesktop.setApiUrl) window.receiptlyDesktop.setApiUrl(v); }
    document.getElementById('u').addEventListener('keydown', function(e){ if(e.key==='Enter') go(); });
    document.getElementById('u').focus();
  </script>
  </body>`;
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1320,
    height: 880,
    title: "receiptly",
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: false },
  });
  // If the dashboard URL is unreachable, show the Connect screen instead of a
  // browser error page. (Ignore aborted loads and our own data: connect screen.)
  mainWin.webContents.on("did-fail-load", (_e, code, desc, failingUrl) => {
    if (code === -3) return;
    if (!failingUrl || failingUrl.startsWith("data:")) return;
    showConnect(desc || `error ${code}`);
  });
  loadDashboard();
}

const status = (msg) => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("rcpt-status", msg);
};

function publixDetailUrl(store, item) {
  return (
    "https://www.publix.com/account/purchases/purchase-details" +
    `?storeNumber=${store}` +
    `&purchaseDate=${encodeURIComponent(item.PurchaseDate)}` +
    `&key=${encodeURIComponent(item.Id)}`
  );
}

// Keep the Publix login: the persist:publix partition already saves persistent
// cookies, but session cookies (no expiry) are dropped on quit. Re-write Publix's
// session cookies with a 30-day expiry + flush, so the next connect skips login.
async function persistPublixSession(sess) {
  try {
    const cookies = await sess.cookies.get({});
    const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
    for (const c of cookies) {
      const host = (c.domain || "").replace(/^\./, "");
      if (!/publix\.com$/.test(host) || c.expirationDate) continue; // skip non-publix + already-persistent
      const url = (c.secure ? "https://" : "http://") + host + (c.path || "/");
      await sess.cookies
        .set({
          url,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
          expirationDate: farFuture,
        })
        .catch(() => {});
    }
    await sess.cookies.flushStore();
  } catch (e) {
    /* best effort */
  }
}

async function connectPublix() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: "Sign in to Publix",
    webPreferences: {
      partition: "persist:publix",
      preload: path.join(__dirname, "publix-preload.js"),
      contextIsolation: false, // so the preload can wrap the page's fetch/XHR
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.setUserAgent(CHROME_UA);
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (code === -3) return; // -3 = aborted (normal during redirects)
    status(`Couldn't load the page (${desc || code}).`);
  });

  const captured = { list: [], details: [] };
  const seenIds = new Set();
  let store = "";
  let listResolve = null;
  const listReady = new Promise((r) => (listResolve = r));

  const onCapture = (e, msg) => {
    if (e.sender !== win.webContents || !msg) return;
    if (msg.type === "publix-list") {
      // Append (the injection sends fresh items per page) + dedupe by receipt Id.
      for (const it of (msg.body && msg.body.PurchasesList) || []) {
        if (it && it.Id && !seenIds.has(it.Id)) { seenIds.add(it.Id); captured.list.push(it); }
      }
      if (listResolve) { listResolve(); listResolve = null; }
    } else if (msg.type === "publix-detail") {
      captured.details.push(msg.body);
    } else if (msg.type === "store") {
      store = String(msg.body || "");
    }
  };
  ipcMain.on("publix-capture", onCapture);

  win.loadURL(PUBLIX_URL);
  status("Log in to Publix in the window that opened…");

  try {
    await listReady; // resolves once the purchases list loads (after you log in)
    await persistPublixSession(win.webContents.session); // keep the session for next time

    // Let pagination settle — the list keeps growing as extra pages load.
    for (let w = 0, last = -1; w < 12 && last !== captured.list.length; w++) {
      last = captured.list.length;
      await new Promise((r) => setTimeout(r, 600));
    }

    const online = captured.list.filter((l) => l.IsOnlineOrder).length;
    status(`Found ${captured.list.length} receipts (${online} online). Getting items…`);

    const inStore = captured.list.filter((l) => !l.IsOnlineOrder);
    console.log(`[connect] ${captured.list.length} receipts, ${inStore.length} in-store`);
    for (let i = 0; i < inStore.length; i++) {
      if (win.isDestroyed()) break;
      status(`Getting items… in-store receipt ${i + 1}/${inStore.length}`);
      const before = captured.details.length;
      win.loadURL(publixDetailUrl(store, inStore[i])).catch(() => {}); // ignore nav errors
      // Poll (bounded) for a new detail capture — no shared timer to corrupt, can't hang.
      const deadline = Date.now() + 7000;
      while (captured.details.length === before && Date.now() < deadline && !win.isDestroyed()) {
        await new Promise((r) => setTimeout(r, 250));
      }
      console.log(`[connect] detail ${i + 1}/${inStore.length} (${inStore[i].PurchaseDate}): ${captured.details.length > before ? "captured" : "TIMEOUT"}`);
    }

    // Capture is done — close the window before the (possibly slow) ingest so the
    // user isn't staring at a stuck page.
    console.log(`[connect] captured ${captured.list.length} list + ${captured.details.length} details; posting…`);
    ipcMain.removeListener("publix-capture", onCapture);
    if (!win.isDestroyed()) win.close();
    status(`Sending ${captured.list.length} receipts to receiptly… (this can take a minute)`);

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 180000);
    let data;
    try {
      const res = await fetch(`${getApiUrl()}/api/connectors/publix/raw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(captured),
        signal: ctrl.signal,
      });
      data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Backend rejected the receipts.");
    } finally {
      clearTimeout(to);
    }
    console.log(`[connect] ingest done: ${JSON.stringify(data)}`);
    status(`✅ ${data.receipts ?? 0} receipts · ${data.matched ?? 0}/${data.total ?? 0} matched. Refreshing…`);
    setTimeout(() => loadDashboard(), 1800);
  } catch (e) {
    console.log(`[connect] error: ${e && e.message ? e.message : String(e)}`);
    status("Error: " + (e && e.message ? e.message : String(e)));
  } finally {
    ipcMain.removeListener("publix-capture", onCapture);
    if (!win.isDestroyed()) win.close();
  }
}

ipcMain.handle("connect-publix", () => connectPublix());

// Save the receiptly server URL (from the Connect screen) and (re)load it.
ipcMain.handle("set-api-url", (_e, url) => {
  const clean = String(url || "").trim().replace(/\/+$/, "");
  if (clean) writeConfig({ apiUrl: clean });
  loadDashboard();
  return { ok: true, apiUrl: getApiUrl() };
});

// ── Generic on-device capture for HTML-receipt merchants (Amazon, Costco) ──
// These merchants have no clean JSON receipt API, so instead of wrapping fetch
// (Publix) we open a real local browser, scrape order refs + each receipt's
// rendered TEXT on-device (html-preload.js), and POST the text to the backend,
// which LLM-extracts the line items. Adding a merchant = one HTML_SPECS entry +
// a scraper in html-preload.js.
const HTML_SPECS = {
  amazon: {
    displayName: "Amazon",
    partition: "persist:amazon",
    // Amazon paginates the order list by ?startIndex; visit the first few pages.
    listUrls: [0, 10, 20].map((s) => `https://www.amazon.com/your-orders/orders?startIndex=${s}`),
    base: "https://www.amazon.com/your-orders",
  },
  costco: {
    displayName: "Costco",
    partition: "persist:costco",
    listUrls: ["https://www.costco.com/OrdersAndPurchases"],
    base: "https://www.costco.com/OrdersAndPurchases",
  },
  wholefoods: {
    displayName: "Whole Foods",
    partition: "persist:amazon", // WFM orders live in your Amazon account → shared login
    listUrls: [0, 10, 20].map((s) => `https://www.amazon.com/your-orders/orders?startIndex=${s}`),
    base: "https://www.amazon.com/your-orders",
  },
};

// Write a capture diagnostic (what the scraper saw) so a real run is debuggable —
// selectors for a new merchant can be tuned from the actual page, not guesswork.
function writeDebug(key, data) {
  try {
    const dir = path.join(app.getPath("userData"), "receiptly-debug");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${key}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return file;
  } catch (e) {
    return null;
  }
}

async function connectHtml(key) {
  const spec = HTML_SPECS[key];
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: `Sign in to ${spec.displayName}`,
    webPreferences: {
      partition: spec.partition,
      preload: path.join(__dirname, "html-preload.js"),
      additionalArguments: [`--rcpt-merchant=${key}`],
      contextIsolation: false, // so the preload can read the page DOM/text
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.setUserAgent(CHROME_UA);
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    if (code === -3) return; // -3 = aborted (normal during redirects)
    status(`Couldn't load the page (${desc || code}).`);
  });

  const orders = new Map(); // id → { id, date, total, receiptUrl, text? }
  const debugLog = []; // per-page scraper diagnostics (for tuning selectors)
  let reachedAt = 0; // when we first landed on the orders page (after login)
  let ordersBump = null; // resolves whenever a new order ref arrives
  const orderArrived = () => new Promise((r) => (ordersBump = r));

  const onCapture = (e, msg) => {
    if (e.sender !== win.webContents || !msg) return;
    if (msg.type === "orders") {
      for (const o of msg.body || []) if (o && o.id && !orders.has(o.id)) orders.set(o.id, o);
      if (ordersBump) { ordersBump(); ordersBump = null; }
    } else if (msg.type === "receipt") {
      const o = orders.get(msg.body.id) || { id: msg.body.id };
      o.text = msg.body.text;
      orders.set(o.id, o);
    } else if (msg.type === "nav") {
      if (!reachedAt && String(msg.body || "").indexOf(spec.base) !== -1) reachedAt = Date.now();
    } else if (msg.type === "debug") {
      debugLog.push(msg.body);
    }
  };
  ipcMain.on("rcpt-html-capture", onCapture);

  try {
    status(`Log in to ${spec.displayName} in the window that opened…`);

    // ── 1. Visit list page(s); the preload scrapes order refs from each ──
    // Page 1 allows a long login window; we stop waiting ~20s after reaching the
    // orders page (so a no-orders run gives up fast instead of stalling).
    for (let i = 0; i < spec.listUrls.length; i++) {
      if (win.isDestroyed()) break;
      win.loadURL(spec.listUrls[i]).catch(() => {});
      const before = orders.size;
      const hardDeadline = Date.now() + (i === 0 ? 180000 : 9000);
      while (orders.size === before && Date.now() < hardDeadline && !win.isDestroyed()) {
        if (i === 0 && reachedAt && Date.now() - reachedAt > 20000) break; // on page, no orders → give up
        await Promise.race([orderArrived(), new Promise((r) => setTimeout(r, 500))]);
      }
      if (i > 0 && orders.size === before) break; // later page added nothing → stop paging
    }

    const refs = [...orders.values()].filter((o) => o.receiptUrl);
    status(`Found ${refs.length} ${spec.displayName} orders. Getting items…`);
    console.log(`[connect] ${key}: ${refs.length} orders with receiptUrl`);

    // ── 2. Open each receipt page; the preload posts its rendered text ──
    for (let i = 0; i < refs.length; i++) {
      if (win.isDestroyed()) break;
      status(`Getting items… order ${i + 1}/${refs.length}`);
      const o = refs[i];
      win.loadURL(o.receiptUrl).catch(() => {});
      const deadline = Date.now() + 9000;
      while (!o.text && Date.now() < deadline && !win.isDestroyed()) {
        await new Promise((r) => setTimeout(r, 250));
      }
      console.log(`[connect] ${key} receipt ${i + 1}/${refs.length} (${o.id}): ${o.text ? "captured" : "TIMEOUT"}`);
    }

    const payload = [...orders.values()]
      .filter((o) => o.text)
      .map((o) => ({ id: o.id, date: o.date || null, total: o.total ?? null, text: o.text }));

    ipcMain.removeListener("rcpt-html-capture", onCapture);
    if (!win.isDestroyed()) win.close();

    // Always save a diagnostic so a real run is debuggable (selectors, counts).
    const dumpFile = writeDebug(key, {
      key,
      ordersFound: orders.size,
      withReceiptUrl: refs.length,
      captured: payload.length,
      orders: [...orders.values()].map((o) => ({ id: o.id, date: o.date, total: o.total, receiptUrl: o.receiptUrl, gotText: !!o.text })),
      pages: debugLog,
    });
    console.log(`[connect] ${key}: debug dump → ${dumpFile}`);

    if (payload.length === 0) {
      console.log(`[connect] ${key}: nothing captured (found ${orders.size} refs)`);
      status(`Couldn't read any ${spec.displayName} receipts yet — saved a debug dump (${dumpFile}).`);
      return;
    }

    status(`Sending ${payload.length} ${spec.displayName} receipts… (reading the items can take a minute)`);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 180000);
    let data;
    try {
      const res = await fetch(`${getApiUrl()}/api/connectors/${key}/raw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orders: payload }),
        signal: ctrl.signal,
      });
      data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Backend rejected the receipts.");
    } finally {
      clearTimeout(to);
    }
    console.log(`[connect] ${key} ingest queued: ${JSON.stringify(data)}`);
    status(`✅ Received ${data.received ?? payload.length} ${spec.displayName} orders — reading items now. Refreshing…`);
    setTimeout(() => loadDashboard(), 2500);
  } catch (e) {
    console.log(`[connect] ${key} error: ${e && e.message ? e.message : String(e)}`);
    status("Error: " + (e && e.message ? e.message : String(e)));
  } finally {
    ipcMain.removeListener("rcpt-html-capture", onCapture);
    if (!win.isDestroyed()) win.close();
  }
}

// Dispatch by merchant: Publix uses the JSON-API capture; the rest use HTML.
function connectMerchant(key) {
  if (key === "publix") return connectPublix();
  if (HTML_SPECS[key]) return connectHtml(key);
  status(`No on-device connector for "${key}" yet.`);
  return Promise.resolve();
}

ipcMain.handle("connect-merchant", (_e, key) => connectMerchant(key));

// Forget a merchant's saved login (cookies + storage) so the next connect logs in
// fresh — e.g. when the wrong account was used.
ipcMain.handle("reauth-merchant", async (_e, key) => {
  const partition = key === "publix" ? "persist:publix" : HTML_SPECS[key] && HTML_SPECS[key].partition;
  if (!partition) return { ok: false, error: `unknown merchant "${key}"` };
  try {
    await session.fromPartition(partition).clearStorageData();
    status(`Signed out. Click Connect & fetch to log in with a different account.`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

// Forget the saved Publix login (cookies + storage) so the next connect logs in
// fresh — e.g. when the wrong account was used.
ipcMain.handle("reauth-publix", async () => {
  try {
    await session.fromPartition("persist:publix").clearStorageData();
    status("Signed out of Publix. Click Connect & fetch to log in with a different account.");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

app.whenReady().then(() => {
  createMain();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMain();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
