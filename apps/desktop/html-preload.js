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
  // Amazon (and Whole Foods, which lives in the Amazon account): collect order IDs
  // from ANY order link on the page (View invoice, order-details, track package, …)
  // and build the printable-invoice URL. Date/total are best-effort from the
  // surrounding card — the backend LLM reads them off the invoice anyway, so a miss
  // here doesn't lose the receipt. Order id format is ddd-ddddddd-ddddddd.
  function amazonReceiptId(url) {
    var m = String(url).match(/[?&]order(?:id)?=(\d{3}-\d{7}-\d{7})/i);
    return m ? m[1] : null;
  }
  function amazonOrders(wfmOnly) {
    var out = [];
    var seen = {};
    var anchors = document.querySelectorAll("a[href]");
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].href || anchors[i].getAttribute("href") || "";
      var m = href.match(/[?&]order(?:id)?=(\d{3}-\d{7}-\d{7})/i);
      if (!m || seen[m[1]]) continue;
      var id = m[1];
      var card = anchors[i].closest('[class*="order-card"]');
      // A real Whole Foods Market order carries a "wfm" link ref. The "365 by Whole
      // Foods Market" brand in a normal shipped Amazon order does NOT — so detect on
      // the ref, not the product name. amazon skips WFM; wholefoods keeps only WFM.
      var isWfm = !!card && /wfm/i.test(card.innerHTML || "");
      if (wfmOnly ? !isWfm : isWfm) continue;
      seen[id] = 1;
      var cardText = card ? (card.innerText || "").replace(/\s+/g, " ") : "";
      var dm = cardText.match(/([A-Za-z]+ \d{1,2},? \d{4})/);
      var tm = cardText.match(/\$([\d,]+\.\d{2})/);
      // Product thumbnails on the card → matched to the invoice's line items on the
      // backend (by title), so the receipt shows real photos.
      var products = [];
      if (card) {
        var imgs = card.querySelectorAll("img");
        var ps = {};
        for (var k = 0; k < imgs.length; k++) {
          var src = imgs[k].currentSrc || imgs[k].src || imgs[k].getAttribute("src") || "";
          if (!/media-amazon\.com\/images\/I\//.test(src) || ps[src]) continue;
          ps[src] = 1;
          products.push({ image: src, title: (imgs[k].alt || "").replace(/\s+/g, " ").trim() });
        }
      }
      out.push({
        id: id,
        date: dm ? isoDate(dm[1]) : null,
        total: tm ? num(tm[1]) : null,
        receiptUrl: "https://www.amazon.com/gp/css/summary/print.html?orderID=" + id,
        products: products,
      });
    }
    return out;
  }

  var SCRAPERS = {
    amazon: {
      isReceiptUrl: amazonReceiptId,
      scrapeOrders: function () { return amazonOrders(false); },
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

    wholefoods: {
      // Whole Foods orders are the WFM-tagged orders in the Amazon account.
      isReceiptUrl: amazonReceiptId,
      scrapeOrders: function () { return amazonOrders(true); },
    },
  };

  // A sample of order/receipt-ish links on the page — the raw material for tuning a
  // merchant's selectors when a real run finds nothing.
  function sampleAnchors() {
    var out = [];
    var anchors = document.querySelectorAll("a[href]");
    for (var i = 0; i < anchors.length && out.length < 40; i++) {
      var href = anchors[i].getAttribute("href") || "";
      if (!/order|receipt|purchase|orderID|invoice/i.test(href)) continue;
      out.push({ href: abs(href), text: (anchors[i].innerText || "").replace(/\s+/g, " ").trim().slice(0, 80) });
    }
    return out;
  }

  // A sample of <img> sources on the page — to see the real product-image URL
  // pattern (and whether they sit inside an order card) when photos don't attach.
  function sampleImages() {
    var out = [];
    var imgs = document.querySelectorAll("img");
    for (var i = 0; i < imgs.length && out.length < 24; i++) {
      var src = imgs[i].currentSrc || imgs[i].src || imgs[i].getAttribute("src") || imgs[i].getAttribute("data-src") || "";
      if (!src || src.indexOf("data:") === 0) continue;
      out.push({ src: src, alt: (imgs[i].alt || "").slice(0, 60), inCard: !!imgs[i].closest('[class*="order-card"]') });
    }
    return out;
  }

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
      if (fresh.length) {
        post("orders", fresh);
      } else {
        // Found nothing new — emit a diagnostic of what's actually on the page
        // (after React renders) so the selectors can be fixed from a real run.
        post("debug", {
          url: location.href,
          title: document.title,
          found: orders.length,
          orderCards: document.querySelectorAll('[class*="order-card"]').length,
          anchors: sampleAnchors(),
          images: sampleImages(),
        });
      }
    } catch (e) {
      post("debug", { url: location.href, error: String(e && e.message ? e.message : e) });
    }
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
