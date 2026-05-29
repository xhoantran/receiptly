// Injected into the Publix WebView (before each page's content loads). It wraps
// fetch + XHR to capture the receipt API responses the page itself makes — the
// SAME endpoints the server-side connector watches — and posts them to React
// Native via window.ReactNativeWebView.postMessage. It also posts the store
// number (needed to build in-store detail URLs) and every navigation.
//
// Because the user is logged in inside a real WebView on their own device, these
// requests carry valid Akamai sensor cookies + a residential IP, so they pass.
export const PUBLIX_INJECT = `
(function () {
  function post(type, body) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, body: body })); } catch (e) {}
  }
  function match(url) {
    if (typeof url !== 'string') return null;
    if (url.indexOf('/api/v4/customer/publix/purchaseslist') !== -1) return 'publix-list';
    if (url.indexOf('/api/v1/PurchaseHistory/detail') !== -1) return 'publix-detail';
    return null;
  }
  function readStore() {
    var store = null;
    try {
      var sm = document.cookie.match(/(?:^|;\\s*)Store=([^;]+)/);
      if (sm) { var p = JSON.parse(decodeURIComponent(sm[1])); store = String(p.StoreNumber || p.storeNumber || ''); }
    } catch (e) {}
    if (!store) {
      try { var cmi = localStorage.getItem('CartMicroserviceInfo'); if (cmi) store = String(JSON.parse(cmi).storeId || ''); } catch (e) {}
    }
    return store || '';
  }

  if (!window.__receiptlyHooked) {
    window.__receiptlyHooked = true;

    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input, init) {
        var url = (input && input.url) ? input.url : input;
        return origFetch.apply(this, arguments).then(function (res) {
          var t = match(url);
          if (t) { res.clone().json().then(function (j) { post(t, j); }).catch(function () {}); }
          return res;
        });
      };
    }

    var P = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (P && !P.__receiptlyHooked) {
      P.__receiptlyHooked = true;
      var origOpen = P.open, origSend = P.send;
      P.open = function (m, u) { this.__rcptUrl = u; return origOpen.apply(this, arguments); };
      P.send = function () {
        var self = this;
        this.addEventListener('load', function () {
          var t = match(self.__rcptUrl);
          if (t) { try { post(t, JSON.parse(self.responseText)); } catch (e) {} }
        });
        return origSend.apply(this, arguments);
      };
    }
  }

  post('nav', location.href);
  var s = readStore();
  if (s) post('store', s);
})();
true;
`;
