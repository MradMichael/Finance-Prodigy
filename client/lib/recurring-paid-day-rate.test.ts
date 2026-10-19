// Item 3d (owner, session 25; the follow-up planned in session 24's item 3):
// recurringPaidSoFar added each confirming row's raw amount, whatever its
// currency. A confirmed payment can be in the other currency (the edit sheet
// changes a row's currency), so a $100 × 3 capped item read paid off after one
// L£8,950,000 (~$100) payment, and its later cycles stopped being offered.
// Each row now converts into the item's currency at the rate on its own day.
import { it, expect } from "vitest";
import { recurringPaidSoFar, nominalMonthlyEquivalent, nextConfirmTarget, remainingInstallments, DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "./localData";
import { storedDay } from "./calendarDay";

const USD_ITEM: StoredRecurring = {
  id: "r1", name: "Course", emoji: "C", amount: 100, currency: "USD", frequency: "monthly", bucket: "NEEDS",
  startDate: "2026-09-05", endDate: null, totalAmount: 300, createdAt: "2026-09-01T00:00:00.000Z",
};
const LBP_ITEM: StoredRecurring = { ...USD_ITEM, id: "r2", name: "Generator", amount: 9_000_000, currency: "LBP", totalAmount: 27_000_000 };
const paid = (id: string, recurringId: string, amount: number, currency: "USD" | "LBP", date: string) =>
  ({ id, amount, currency, bucket: "NEEDS", description: id, date, cycleDate: date, recurringId }) as StoredTransaction;
const data = (transactions: StoredTransaction[], o: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, recurring: [USD_ITEM, LBP_ITEM], transactions, ...o }) as LocalFinancials;

it("a dollar item paid once in lira: L£8,950,000 at 89,500 counts $100, not 8,950,000", () => {
  const d = data([paid("p1", "r1", 8_950_000, "LBP", "2026-09-05")]);
  expect(recurringPaidSoFar(USD_ITEM, d.transactions, d)).toBe(100);
});

it("so the item isn't ended: it still costs $100 a month and its next cycle is still offered", () => {
  const d = data([paid("p1", "r1", 8_950_000, "LBP", "2026-09-05")]);
  const asOf = storedDay("2026-10-06");
  expect(nominalMonthlyEquivalent(USD_ITEM, d.transactions, d, new Date(Date.UTC(2026, 9, 6)))).toBe(100);
  expect(nextConfirmTarget(USD_ITEM, d.transactions, d, asOf)).not.toBeNull();
  expect(remainingInstallments(USD_ITEM, d.transactions, d, asOf)?.count).toBe(2);
});

it("a lira item paid once in dollars: $100 at 90,000 counts L£9,000,000", () => {
  const d = data([paid("p2", "r2", 100, "USD", "2026-09-05")], { lbpRate: 90_000 });
  expect(recurringPaidSoFar(LBP_ITEM, d.transactions, d)).toBe(9_000_000);
});

it("at the payment's own day's rate, not today's", () => {
  const d = data([paid("p1", "r1", 10_000_000, "LBP", "2026-09-05")], { lbpRate: 179_000, lbpRateLog: [{ from: "2026-09-01", value: 100_000 }, { from: "2026-10-01", value: 179_000 }] });
  expect(recurringPaidSoFar(USD_ITEM, d.transactions, d)).toBe(100);
});

it("same-currency payments are unchanged, and the cap still holds", () => {
  const d = data([paid("p1", "r1", 100, "USD", "2026-09-05"), paid("p3", "r1", 250, "USD", "2026-10-05")]);
  expect(recurringPaidSoFar(USD_ITEM, d.transactions, d)).toBe(300);
});
