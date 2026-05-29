import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Connector, ExtractedReceipt, Tx } from "./types.js";
import type { ReceiptItem } from "../lib/extract.js";
import type { Page } from "playwright";

const KEY = "publix";
const PURCHASES_URL = "https://www.publix.com/account/purchases?nav=account_sidebar_button";
const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");

export type PublixListItem = {
  Id: string;
  StoreName: string;
  PurchaseDate: string;
  TotalPrice: number;
  IsOnlineOrder: boolean;
  Subtotal?: number;
  TotalTax?: number;
  LineItems?: Array<{
    DisplayName: string;
    Quantity: number;
    Total: number;
    ItemBaseUnitPrice: number;
    ProductImageFilename?: string | null;
  }>;
};

type PublixLineItem = {
  ItemCode: string | number;
  ItemQty: number;
  ItemWeight?: number;
  ItemPrice: number;
  ItemAmount: number;
  NetAmount: number;
  SavingAmount?: number;
};

export type PublixDetail = {
  ReceiptId?: string;
  TransactionKey: string;
  TransactionDate: string;
  FacilityName: string;
  OrderTotal: number;
  TaxAmount: number;
  GrandTotal: number;
  Products: Array<{ ItemName: string; ItemQuantity: number; UPC: string; ItemImageUrl?: string | null }> | null;
  ReceiptLineItems: PublixLineItem[] | null;
};

/** ItemCode is the UPC zero-padded to 14 digits — strip leading zeros to compare. */
function upcKey(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/^0+/, "");
}

export function normalizePublixOnline(l: PublixListItem): ExtractedReceipt {
  const items: ReceiptItem[] = (l.LineItems ?? []).map((li) => {
    const qty = li.Quantity ?? 1;
    return {
      name: li.DisplayName,
      qty,
      unit: "ea",
      unit_price: qty > 0 ? Number((li.Total / qty).toFixed(2)) : li.ItemBaseUnitPrice,
      line_total: li.Total,
      saving: 0,
      image_url: li.ProductImageFilename ?? null,
    };
  });
  return {
    receipt_id: l.Id,
    date: l.PurchaseDate.slice(0, 10),
    store: l.StoreName,
    total: l.TotalPrice,
    subtotal: l.Subtotal ?? null,
    tax: l.TotalTax ?? null,
    items,
  };
}

export function normalizePublixDetail(d: PublixDetail): ExtractedReceipt {
  const products = d.Products ?? [];
  const lines = d.ReceiptLineItems ?? [];

  // Products (catalog order) and ReceiptLineItems (receipt order) are NOT in the
  // same order. Join by UPC↔ItemCode. Use a per-key queue so repeat purchases of
  // the same UPC consume distinct line items. Fall back to index only if no match.
  const pool = new Map<string, PublixLineItem[]>();
  for (const li of lines) {
    const k = upcKey(li.ItemCode);
    const q = pool.get(k) ?? [];
    q.push(li);
    pool.set(k, q);
  }

  const items: ReceiptItem[] = products.map((p, i) => {
    const q = pool.get(upcKey(p.UPC));
    const li = (q && q.shift()) ?? lines[i];

    // Weight-priced items (steak, produce) report ItemQty=0 + ItemWeight>0, priced
    // per lb. Counted items report ItemQty>=1. The receipt LINE is authoritative —
    // Products.ItemQuantity is catalog noise.
    const weight = li?.ItemWeight ?? 0;
    const byWeight = (li?.ItemQty ?? 0) === 0 && weight > 0;
    const qty = byWeight ? weight : li?.ItemQty || p.ItemQuantity || 1;
    const unit = byWeight ? "lb" : "ea";

    // line_total is what was actually paid (NetAmount, after savings incl. BOGO).
    // unit_price = paid ÷ qty — honest "what it cost me", not the shelf/multi-buy
    // figure (ItemPrice can be "2 / $11" while you paid $5.50 for one).
    const lineTotal = li?.NetAmount ?? li?.ItemAmount ?? 0;
    const saving = li?.SavingAmount ?? 0;
    const unitPrice = qty > 0 ? Number((lineTotal / qty).toFixed(2)) : (li?.ItemPrice ?? 0);

    return {
      name: p.ItemName,
      qty: Number(qty.toFixed(3)),
      unit,
      unit_price: unitPrice,
      line_total: lineTotal,
      saving,
      image_url: p.ItemImageUrl ?? null,
    };
  });

  return {
    receipt_id: d.ReceiptId ?? d.TransactionKey,
    date: d.TransactionDate.slice(0, 10),
    store: d.FacilityName,
    total: d.GrandTotal,
    subtotal: d.OrderTotal ?? null,
    tax: d.TaxAmount ?? null,
    items,
  };
}

function detailPageUrl(store: string, item: PublixListItem): string {
  // Matches the link pattern observed in the receipts list:
  // https://www.publix.com/account/purchases/purchase-details
  //   ?storeNumber=<n>&purchaseDate=<iso>&key=<urlencoded(Id)>
  return (
    "https://www.publix.com/account/purchases/purchase-details" +
    `?storeNumber=${store}` +
    `&purchaseDate=${encodeURIComponent(item.PurchaseDate)}` +
    `&key=${encodeURIComponent(item.Id)}`
  );
}

async function getStore(page: Page): Promise<string> {
  return page.evaluate(() => {
    let store: string | null = null;
    const sm = document.cookie.match(/(?:^|;\s*)Store=([^;]+)/);
    if (sm) {
      try {
        const parsed = JSON.parse(decodeURIComponent(sm[1]));
        store = String(parsed.StoreNumber ?? parsed.storeNumber ?? "");
      } catch (_) {}
    }
    if (!store) {
      const cmi = localStorage.getItem("CartMicroserviceInfo");
      if (cmi) {
        try { store = String(JSON.parse(cmi).storeId ?? ""); } catch (_) {}
      }
    }
    return store || "";
  });
}

export const publixConnector: Connector = {
  key: KEY,
  displayName: "Publix",
  mode: "browser",
  loginUrl: PURCHASES_URL,

  matches(tx: Tx) {
    return /publix/i.test(`${tx.merchant} ${tx.raw_name}`);
  },

  async isLoggedIn(page: Page) {
    return page.url().includes("publix.com/account/purchases");
  },

  async fetchReceipts(ctx): Promise<ExtractedReceipt[]> {
    const debug = resolve(DATA_DIR, "debug");
    await mkdir(debug, { recursive: true });
    const { page } = ctx;

    {
      const store = await getStore(page);
      if (!store) throw new Error("Could not read PublixStore from cookies / localStorage");
      console.log(`[${KEY}] PublixStore=${store}`);

      // ─── List: trigger by reload, capture the response the page already makes ───
      console.log(`[${KEY}] reloading purchases page to capture /purchaseslist…`);
      const listPromise = page.waitForResponse(
        (r) => r.url().includes("/api/v4/customer/publix/purchaseslist"),
        { timeout: 30000 }
      );
      await page.goto(PURCHASES_URL, { waitUntil: "domcontentloaded" });
      const listRes = await listPromise;
      const listBody = await listRes.json() as { PurchasesList: PublixListItem[]; TotalPages: number };
      await writeFile(resolve(debug, "publix-list.json"), JSON.stringify(listBody, null, 2));
      const list = listBody.PurchasesList ?? [];
      console.log(`[${KEY}] got ${list.length} receipts in list.\n`);

      // ─── Online orders: items live in the list response itself; no nav needed ───
      // ─── In-store: navigate to detail page, capture /PurchaseHistory/detail ───
      const receipts: ExtractedReceipt[] = [];
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        const tag = l.IsOnlineOrder ? "online" : "in-store";
        console.log(`[${KEY}] [${i + 1}/${list.length}] ${l.PurchaseDate.slice(0, 10)} $${l.TotalPrice} (${tag})`);

        if (l.IsOnlineOrder) {
          const r = normalizePublixOnline(l);
          receipts.push(r);
          console.log(`[${KEY}]   → ${r.items.length} items (from list LineItems)`);
          continue;
        }

        if (page.isClosed()) {
          console.error(`[${KEY}]   ✗ page closed/crashed; stopping detail iteration`);
          break;
        }

        try {
          const detailUrl = detailPageUrl(store, l);
          const detailPromise = page.waitForResponse(
            (r) => r.url().includes("/api/v1/PurchaseHistory/detail"),
            { timeout: 20000 }
          );
          await page.goto(detailUrl, { waitUntil: "domcontentloaded" });
          const detailRes = await detailPromise;
          const detail = await detailRes.json() as PublixDetail;
          await writeFile(resolve(debug, `publix-detail-${i}.json`), JSON.stringify(detail, null, 2));
          receipts.push(normalizePublixDetail(detail));
          console.log(`[${KEY}]   → ${detail.Products?.length ?? 0} items`);
        } catch (err) {
          const msg = String(err);
          console.error(`[${KEY}]   ✗ ${msg.slice(0, 150)}`);
          if (/Page crashed|Target page.*closed/i.test(msg)) {
            console.error(`[${KEY}]   page crashed; returning ${receipts.length} receipts collected so far`);
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      return receipts;
    }
  },
};
