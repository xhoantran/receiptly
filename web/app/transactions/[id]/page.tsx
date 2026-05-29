import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getTransaction,
  getMatchForTransaction,
  money,
  longDate,
  qtyLabel,
  chipFor,
  emojiFor,
} from "@/lib/data";
import { MerchantBadge, Card } from "@/components/ui";
import { ItemImage } from "@/components/ItemImage";

export default async function TransactionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [tx, receipt] = await Promise.all([getTransaction(id), getMatchForTransaction(id)]);
  if (!tx) notFound();

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/transactions" className="mb-6 inline-flex text-[14px] font-semibold text-sprout-deep hover:underline">
        ← Back
      </Link>

      {/* Transaction header */}
      <Card className="rise mb-6 flex items-center gap-4 p-5">
        <MerchantBadge chip={chipFor(tx.merchant)} emoji={emojiFor(tx.merchant)} size={56} />
        <div className="flex-1">
          <h1 className="font-display text-2xl font-semibold text-ink">{tx.merchant}</h1>
          <p className="text-[14px] text-muted">{longDate(tx.date)}</p>
        </div>
        <span className="amount text-2xl font-semibold text-ink">{money(tx.amount)}</span>
      </Card>

      {receipt ? (
        <Receipt receipt={receipt} />
      ) : (
        <Card className="rise p-8 text-center" style={{ animationDelay: "80ms" }}>
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-cream text-2xl">🔍</div>
          <p className="font-display text-lg font-semibold text-ink">No itemized receipt yet</p>
          <p className="mx-auto mt-1 max-w-xs text-[14px] leading-snug text-muted">
            {tx.connectorKey
              ? "This purchase wasn't found in the merchant's receipt history — likely a non-loyalty or in-store cash visit."
              : "No connector covers this merchant yet. Want to build one?"}
          </p>
        </Card>
      )}
    </div>
  );
}

type ReceiptVM = {
  id: string;
  date: string;
  store: string | null;
  total: number;
  subtotal: number | null;
  tax: number | null;
  items: {
    id: number;
    name: string;
    qty: number;
    unit: string | null;
    unitPrice: number | null;
    lineTotal: number;
    saving: number | null;
    imageUrl: string | null;
  }[];
};

function Receipt({ receipt }: { receipt: ReceiptVM }) {
  return (
    <div className="rise" style={{ animationDelay: "80ms" }}>
      <div className="perf-edge bg-surface px-7 py-7 shadow-pop">
        <div className="mb-5 text-center">
          <p className="font-display text-xl font-semibold text-ink">{receipt.store ?? "Receipt"}</p>
          <p className="text-[13px] text-muted">{longDate(receipt.date)}</p>
          <div className="mx-auto mt-4 h-px w-full bg-line" />
        </div>

        <ul className="space-y-3">
          {receipt.items.map((it) => {
            const free = it.lineTotal === 0 && (it.saving ?? 0) > 0;
            return (
              <li key={it.id} className="flex items-center gap-3">
                <ItemImage src={it.imageUrl} name={it.name} size={38} />
                <span className="amount w-12 shrink-0 text-[12px] text-muted">
                  {qtyLabel(it.qty, it.unit)}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-[14px] leading-snug text-ink">{it.name}</span>
                  {(it.saving ?? 0) > 0 && (
                    <span className="ml-2 rounded-pill bg-sprout-soft px-1.5 py-0.5 text-[11px] font-semibold text-sprout-deep">
                      {free ? "BOGO" : "sale"} · saved {money(it.saving)}
                    </span>
                  )}
                </div>
                <span className={`amount text-[14px] font-medium ${free ? "text-sprout-deep" : "text-ink"}`}>
                  {free ? "FREE" : money(it.lineTotal)}
                </span>
              </li>
            );
          })}
          {receipt.items.length === 0 && (
            <li className="py-2 text-center text-[14px] text-muted">No line items recorded.</li>
          )}
        </ul>

        <div className="mt-5 space-y-1.5 border-t border-dashed border-line pt-4">
          {receipt.subtotal != null && (
            <Row label="Subtotal" value={money(receipt.subtotal)} muted />
          )}
          {receipt.tax != null && <Row label="Tax" value={money(receipt.tax)} muted />}
          <Row label="Total" value={money(receipt.total)} bold />
        </div>

        <p className="mt-6 text-center text-[11px] uppercase tracking-[0.2em] text-muted">
          ✦ fetched by receiptly ✦
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={`text-[13px] ${bold ? "font-display text-base font-semibold text-ink" : muted ? "text-muted" : "text-ink"}`}>
        {label}
      </span>
      <span className={`amount ${bold ? "text-base font-semibold text-ink" : muted ? "text-[13px] text-muted" : "text-[14px] text-ink"}`}>
        {value}
      </span>
    </div>
  );
}
