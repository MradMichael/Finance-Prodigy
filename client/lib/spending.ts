// Session 19, item 2 (owner: "Option 1 (reimbursement row, netted)"):
// spending is counted by ONE rule, here, and every place in the app that
// totals Wants, a bucket, all spending, or spending by category calls these
// functions with its own converter (no copies of the rule).
//   - NEEDS, WANTS and SAVINGS rows count in their own bucket.
//   - A change-back (foreign cash changed back: a reimbursement-shaped
//     TRANSFER with `fx.kind: "back"`) counts AGAINST Wants, in its own month,
//     and in its own category: the exchange it undoes counted as Wants.
//   - Nothing else counts: income, a transfer's legs, and every other
//     reimbursement stay out of every budget total, as the approved hint says.
// A month's Wants can go below zero (a change-back in a month with less Wants
// than it); it's returned as it is, never capped.
// Units (2.4.138): each figure is in whatever `valueOf` returns (USD at every
// call site but the currency screen's own per-currency sums).
import type { StoredTransaction } from "./localData";

export type SpendBucket = "NEEDS" | "WANTS" | "SAVINGS";
type Row = Pick<StoredTransaction, "bucket" | "fx" | "category">;

/** Foreign cash changed back: a TRANSFER naming the foreign amount given back. */
export function isChangeBack(t: Pick<StoredTransaction, "bucket" | "fx">): boolean {
  return t.bucket === "TRANSFER" && t.fx?.kind === "back";
}

/** THE rule: which spending bucket a row counts in, and which way; null when it isn't spending. */
export function spendingEffect(t: Row): { bucket: SpendBucket; sign: 1 | -1 } | null {
  if (t.bucket === "NEEDS" || t.bucket === "WANTS" || t.bucket === "SAVINGS") return { bucket: t.bucket, sign: 1 };
  if (isChangeBack(t)) return { bucket: "WANTS", sign: -1 };
  return null;
}

/** Spending by bucket, each row through `valueOf`. Wants nets change-backs. */
export function spentByBucket<T extends Row>(rows: readonly T[], valueOf: (t: T) => number): { needs: number; wants: number; savings: number } {
  const out = { needs: 0, wants: 0, savings: 0 };
  for (const t of rows) {
    const e = spendingEffect(t);
    if (!e) continue;
    const v = e.sign * valueOf(t);
    if (e.bucket === "NEEDS") out.needs += v; else if (e.bucket === "WANTS") out.wants += v; else out.savings += v;
  }
  return out;
}

/** Wants spent: the one figure every Wants total in the app is. */
export function wantsSpent<T extends Row>(rows: readonly T[], valueOf: (t: T) => number): number {
  return spentByBucket(rows, valueOf).wants;
}

/** All spending: Needs + Wants (net of change-backs) + Savings. */
export function totalSpent<T extends Row>(rows: readonly T[], valueOf: (t: T) => number): number {
  const b = spentByBucket(rows, valueOf);
  return b.needs + b.wants + b.savings;
}

/** Spending by category (keyed by `keyOf`, "uncategorized" by default); a change-back nets in its own. */
export function spentByCategory<T extends Row>(rows: readonly T[], valueOf: (t: T) => number, keyOf: (t: T) => string = (t) => t.category ?? "uncategorized"): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of rows) {
    const e = spendingEffect(t);
    if (!e) continue;
    const k = keyOf(t);
    out.set(k, (out.get(k) ?? 0) + e.sign * valueOf(t));
  }
  return out;
}
