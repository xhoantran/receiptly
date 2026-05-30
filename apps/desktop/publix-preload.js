// Injected into the Publix login window (contextIsolation:false, so it shares the
// page's window and can wrap fetch/XHR — the SAME approach as the mobile WebView,
// no CDP/debugger). Captures the receipt API responses + the store number and
// relays them to the main process over IPC (ipcRenderer kept in closure, never
// exposed to the page).
//
// The purchases list is PAGINATED (response.TotalPages). After page 1 we replay
// the page's own list request for the remaining pages — from inside the logged-in
// page, so each call is a real browser request that clears Akamai.
const { ipcRenderer } = require("electron");

(function () {
  function post(type, body) {
    try { ipcRenderer.send("publix-capture", { type: type, body: body }); } catch (e) {}
  }
  function match(url) {
    if (typeof url !== "string") return null;
    if (url.indexOf("/api/v4/customer/publix/purchaseslist") !== -1) return "publix-list";
    if (url.indexOf("/api/v1/PurchaseHistory/detail") !== -1) return "publix-detail";
    return null;
  }
  function readStore() {
    var store = null;
    try {
      var sm = document.cookie.match(/(?:^|;\s*)Store=([^;]+)/);
      if (sm) { var p = JSON.parse(decodeURIComponent(sm[1])); store = String(p.StoreNumber || p.storeNumber || ""); }
    } catch (e) {}
    if (!store) {
      try { var cmi = localStorage.getItem("CartMicroserviceInfo"); if (cmi) store = String(JSON.parse(cmi).storeId || ""); } catch (e) {}
    }
    return store || "";
  }

  if (!window.__rcptHooked) {
    window.__rcptHooked = true;
    var origFetch = window.fetch;

    // Build the request for page `p` from the captured page-1 request: bump an
    // existing page query param, else default to ?pageNumber=p (Publix is .NET).
    function pageUrl(u, p) {
      var r = u.replace(/([?&](?:page|pageNumber|pageIndex|pageNo|pageNum)=)\d+/i, "$1" + p);
      if (r !== u) return r;
      return u + (u.indexOf("?") === -1 ? "?" : "&") + "pageNumber=" + p;
    }
    function fetchPage(tmpl, p) {
      var u = pageUrl(tmpl.url, p);
      return tmpl.request ? origFetch(new Request(u, tmpl.request)) : origFetch(u, tmpl.init);
    }

    function fetchRemainingPages(firstPage, tmpl) {
      if (window.__rcptPaginated || !tmpl) return;
      window.__rcptPaginated = true;
      var total = (firstPage && firstPage.TotalPages) || 1;
      if (total <= 1) return;
      var seen = {};
      (firstPage.PurchasesList || []).forEach(function (x) { seen[x.Id] = 1; });
      (async function () {
        for (var p = 2; p <= total && p <= 40; p++) {
          try {
            var res = await fetchPage(tmpl, p);
            var j = await res.json();
            var items = (j && j.PurchasesList) || [];
            var fresh = items.filter(function (x) { return x && !seen[x.Id]; });
            if (fresh.length === 0) break; // no new receipts — stop (or page param wrong)
            fresh.forEach(function (x) { seen[x.Id] = 1; });
            post("publix-list", { PurchasesList: fresh, TotalPages: total });
          } catch (e) { break; }
        }
      })();
    }

    if (origFetch) {
      window.fetch = function (input) {
        var url = (input && input.url) ? input.url : input;
        var t = match(url);
        if (t === "publix-list" && !window.__rcptListReq) {
          window.__rcptListReq =
            input instanceof Request
              ? { request: input.clone(), url: input.url, init: null }
              : { request: null, url: String(input), init: arguments[1] || {} };
        }
        var promise = origFetch.apply(this, arguments);
        if (t) {
          promise.then(function (res) {
            res.clone().json().then(function (j) {
              post(t, j);
              if (t === "publix-list") fetchRemainingPages(j, window.__rcptListReq);
            }).catch(function () {});
          });
        }
        return promise;
      };
    }

    var XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (XP && !XP.__rcptHooked) {
      XP.__rcptHooked = true;
      var origOpen = XP.open, origSend = XP.send;
      XP.open = function (m, u) { this.__rcptUrl = u; return origOpen.apply(this, arguments); };
      XP.send = function () {
        var self = this;
        this.addEventListener("load", function () {
          var t = match(self.__rcptUrl);
          if (t) { try { post(t, JSON.parse(self.responseText)); } catch (e) {} }
        });
        return origSend.apply(this, arguments);
      };
    }
  }

  function reportStore() { var s = readStore(); if (s) post("store", s); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reportStore);
  else reportStore();
})();
