// Generic on-device capture for merchants WITHOUT a clean JSON receipt API
// (Amazon, Costco, …). Unlike Publix (publix-preload.js wraps fetch/XHR for known
// API endpoints), these merchants render receipts as HTML, so we:
//   • on a LIST page  → scrape order refs {id, date, total, receiptUrl} from the DOM
//   • on a RECEIPT page → grab the rendered text (document body) for the backend LLM
// and relay both to the main process over IPC. Because it runs inside a real
// logged-in browser on the user's own machine, the requests carry valid bot-defense
// cookies + a residential IP, so the pages load like a normal visit.
//
// Per-merchant logic lives in SCRAPERS[key]. Adding a merchant = one entry there.
// The active merchant is passed by main.js via additionalArguments (--rcpt-merchant=).
const { ipcRenderer } = require("electron");

(function () {
  function post(type, body) {
    try { ipcRenderer.send("rcpt-html-capture", { type: type, body: body }); } catch (e) {}
  }

  // Which merchant are we? main.js sets webPreferences.additionalArguments.
  var KEY = "";
  for (var i = 0; i < process.argv.length; i++) {
    var m = String(process.argv[i]).match(/^--rcpt-merchant=(.+)$/);
    if (m) { KEY = m[1]; break; }
  }

  function abs(href) {
    try { return new URL(href, location.href).href; } catch (e) { return href; }
  }
  function isoDate(s) {
    var d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function num(s) {
    if (s == null) return null;
    var v = Number(String(s).replace(/[^0-9.]/g, ""));
    return isNaN(v) ? null : v;
  }

  // ── Per-merchant scrapers ──────────────────────────────────────────────────
  // Each: { isReceiptUrl(url) → id|null, scrapeOrders() → [{id,date,total,receiptUrl}] }
  // `id` MUST be derivable from the receiptUrl alone (so the LIST ref and the later
  // RECEIPT capture share the same id).
  var SCRAPERS = {
    amazon: {
      // Printable invoice — the one page with per-item prices. id = orderID.
      isReceiptUrl: function (url) {
        var m = url.match(/[?&]orderID=([\w-]+)/);
        return m ? m[1] : null;
      },
      scrapeOrders: function () {
        var out = [];
        var cards = document.querySelectorAll('[class*="order-card"]');
        for (var i = 0; i < cards.length; i++) {
          var card = cards[i];
          var text = (card.innerText || "").replace(/\s+/g, " ");
          var inv = card.querySelector('a[href*="orderID="]');
          var idm = inv && inv.href.match(/orderID=([\w-]+)/);
          var dm = text.match(/Order placed\s+([A-Za-z]+ \d{1,2}, \d{4})/);
          var tm = text.match(/Total\s+\$([\d,]+\.\d{2})/);
          if (!idm || !dm) continue;
          out.push({
            id: idm[1],
            date: isoDate(dm[1]),
            total: tm ? num(tm[1]) : null,
            receiptUrl: "https://www.amazon.com/gp/css/summary/print.html?orderID=" + idm[1],
          });
        }
        return out;
      },
    },

    costco: {
      // Costco's order/receipt detail pages carry an id in the query string. We only
      // treat a URL as a receipt when it has one of these params (so the orders LIST
      // page itself is never mistaken for a receipt). Best-effort — Costco renders a
      // React SPA, so selectors may need a tuning pass on the first real session.
      isReceiptUrl: function (url) {
        var m = url.match(/[?&](?:orderHeaderId|documentId|orderNumber|barcode|sourceOrderNumber)=([\w-]+)/i);
        return m ? m[1] : null;
      },
      scrapeOrders: function () {
        var self = this;
        var out = [];
        var seen = {};
        var anchors = document.querySelectorAll("a[href]");
        for (var i = 0; i < anchors.length; i++) {
          var a = anchors[i];
          var href = a.getAttribute("href") || "";
          if (!/order|receipt|purchase/i.test(href)) continue;
          var url = abs(href);
          var id = self.isReceiptUrl(url);
          if (!id || seen[id]) continue;
          seen[id] = 1;
          // Pull date/total from the closest row-ish ancestor's text, best-effort.
          var row = a.closest('[class*="order"],[class*="row"],li,tr,article') || a;
          var t = (row.innerText || "").replace(/\s+/g, " ");
          var dm = t.match(/([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})|(\d{1,2}\/\d{1,2}\/\d{2,4})/);
          var tm = t.match(/\$[\s]?([\d,]+\.\d{2})/);
          out.push({ id: id, date: dm ? isoDate(dm[0]) : null, total: tm ? num(tm[1]) : null, receiptUrl: url });
        }
        return out;
      },
    },
  };

  var scraper = SCRAPERS[KEY];
  if (!scraper) return; // unknown merchant — do nothing

  // ── Run ─────────────────────────────────────────────────────────────────────
  // A RECEIPT page (URL has an id) → post its rendered text. Otherwise it's a LIST
  // page → scrape order refs. React renders late, so we retry a few times and post
  // the cumulative (deduped) set; main.js waits for the first non-empty batch.
  var receiptId = scraper.isReceiptUrl(location.href);

  function postReceipt() {
    var text = (document.body && document.body.innerText) || "";
    if (text.length > 200) post("receipt", { id: receiptId, text: text });
  }

  var sent = {};
  function scrapeAndPost() {
    try {
      var orders = scraper.scrapeOrders() || [];
      var fresh = [];
      for (var i = 0; i < orders.length; i++) {
        var o = orders[i];
        if (o && o.id && !sent[o.id]) { sent[o.id] = 1; fresh.push(o); }
      }
      if (fresh.length) post("orders", fresh);
    } catch (e) {}
  }

  function run() {
    post("nav", location.href);
    if (receiptId) {
      postReceipt();
      setTimeout(postReceipt, 2500);
    } else {
      scrapeAndPost();
      setTimeout(scrapeAndPost, 2000);
      setTimeout(scrapeAndPost, 4000);
      setTimeout(scrapeAndPost, 6500);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
