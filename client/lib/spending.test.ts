// Session 19, item 2 (owner: "Option 1 (reimbursement row, netted)"): spending
// is totalled in ONE place. A change-back (euros changed back: a
// reimbursement-shaped TRANSFER with `fx.kind: "back"`) nets against Wants in
// its own month; every other reimbursement or transfer stays out of every
// budget total, as the approved hint says. A month's Wants can go below zero
// and is shown as it is.
import { describe, it, expect } from "vitest";
import type { StoredTransaction } from "./localData";
import { isChangeBack, spendingEffect, spentByBucket, wantsSpent, totalSpent, spentByCategory } from "./spending";

const row = (id: string, amount: number, extra: Partial<StoredTransaction> = {}): StoredTransaction =>
  ({ id, amount, currency: "USD", bucket: "WANTS", description: id, date: "2026-10-03", ...extra }) as StoredTransaction;
const EXCHANGE = row("ex", 500, { category: "travel", fx: { code: "EUR", amount: 460, kind: "exchange" } });
const BACK = row("back", 105, { bucket: "TRANSFER", category: "travel", fx: { code: "EUR", amount: 100, kind: "back" } });
const REIMB = row("reimb", 20, { bucket: "TRANSFER", category: "dining" }); // an ordinary reimbursement
const LEG_OUT = row("out", -200, { bucket: "TRANSFER", linkedPaymentId: "L1" });
const LEG_IN = row("in", 200, { bucket: "TRANSFER", linkedPaymentId: "L1" });
const usd = (t: StoredTransaction) => t.amount;

describe("the one rule: how a row counts in spending", () => {
  it("Needs, Wants and Savings count in their bucket; a change-back counts against Wants; nothing else counts", () => {
    expect(spendingEffect(row("n", 1, { bucket: "NEEDS" }))).toEqual({ bucket: "NEEDS", sign: 1 });
    expect(spendingEffect(EXCHANGE)).toEqual({ bucket: "WANTS", sign: 1 });
    expect(spendingEffect(row("s", 1, { bucket: "SAVINGS" }))).toEqual({ bucket: "SAVINGS", sign: 1 });
    expect(spendingEffect(BACK)).toEqual({ bucket: "WANTS", sign: -1 });
    for (const t of [REIMB, LEG_OUT, LEG_IN, row("i", 1, { bucket: "INCOME" })]) expect(spendingEffect(t)).toBeNull();
  });

  it("a change-back is a TRANSFER naming euros given back; nothing else is", () => {
    expect(isChangeBack(BACK)).toBe(true);
    expect([EXCHANGE, REIMB, LEG_IN, row("i", 1, { bucket: "INCOME", fx: { code: "EUR", amount: 1, kind: "back" } })].some(isChangeBack)).toBe(false);
  });
});

describe("totals", () => {
  const month = [EXCHANGE, row("lunch", 40), row("rent", 30, { bucket: "NEEDS" }), row("fund", 10, { bucket: "SAVINGS" }), BACK, REIMB, LEG_OUT, LEG_IN];

  it("Wants spent nets the change-back; an ordinary reimbursement and a transfer's legs are left out", () => {
    expect(wantsSpent(month, usd)).toBe(435); // 500 + 40 - 105
    expect(spentByBucket(month, usd)).toEqual({ needs: 30, wants: 435, savings: 10 });
    expect(totalSpent(month, usd)).toBe(475);
  });

  it("a month holding only a change-back shows its Wants below zero, as it is", () => {
    expect(wantsSpent([BACK], usd)).toBe(-105);
    expect(totalSpent([BACK], usd)).toBe(-105);
  });

  it("by category, the change-back nets in its own; the ordinary reimbursement counts nowhere", () => {
    expect(Object.fromEntries(spentByCategory(month, usd))).toEqual({ travel: 395, uncategorized: 80 });
  });

  it("each figure comes through the converter it's given", () => {
    expect(wantsSpent([EXCHANGE, BACK], (t) => t.amount * 2)).toBe(790);
  });
});
