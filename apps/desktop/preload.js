const { contextBridge, ipcRenderer } = require("electron");

// Exposed to the dashboard (loaded as the main window). ConnectMerchant detects
// `window.receiptlyDesktop` and, when present, runs the native on-device login
// for the clicked merchant.
contextBridge.exposeInMainWorld("receiptlyDesktop", {
  // Generic, merchant-keyed bridge (publix | amazon | costco | …).
  connect: (key) => ipcRenderer.invoke("connect-merchant", key),
  reauth: (key) => ipcRenderer.invoke("reauth-merchant", key),
  onStatus: (cb) => ipcRenderer.on("rcpt-status", (_e, msg) => cb(msg)),
  // Set/persist the receiptly server URL (used by the Connect screen).
  setApiUrl: (url) => ipcRenderer.invoke("set-api-url", url),
  // Back-compat aliases (older dashboard builds called these directly).
  connectPublix: () => ipcRenderer.invoke("connect-merchant", "publix"),
  reauthPublix: () => ipcRenderer.invoke("reauth-merchant", "publix"),
});
