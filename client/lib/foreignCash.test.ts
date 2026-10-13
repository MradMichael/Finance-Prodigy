// Foreign cash, model 2 (owner, session 17's plan; session 18 build, held;
// FIX_PLANS.md "FOREIGN CASH, MODEL 2"). It replaces slice 1's pocket at cost.
//   - An exchange is ONE expense row: what was paid, Wants, category Travel,
//     on the pool the money left, with `fx: { kind: "exchange" }` naming the
//     euros received. It counts as spending when it happens.
//   - Euros live on a sheet, one per currency code, derived: exchanges in;
//     spends out (a new list, `foreignEntries`, never in the ledger); euros
//     changed back out; cash received from someone in (decision 4). A
//     running balance in that currency.
//   - A euro spend touches no budget total, no pool and not net worth: it
//     was counted at the exchange.
//   - Changing euros back is ONE reimbursement-shaped row (session 19: not
//     income): a TRANSFER on the pool it went to, category Travel, with
//     `fx: { kind: "back" }`. It nets against Wants in its own month
//     (lib/spending.ts) and lowers the trip; income and targets don't move.
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, softDelete, type LocalFinancials, type StoredTransaction } from "./localData";
import { computeDashboard, periodTotals, trackedBalanceExpected } from "./computeDashboard";
import { isValidForeignCode, buildExchange, buildChangeBack, buildForeignEntry, editForeignEntry, sheet, sheetCodes, foreignCashRole } from "./foreignCash";

const RATE = 89_500;
const data = (transactions: StoredTransaction[] = [], extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, lbpRate: RATE, lbpRateHistory: [], transactions, ...extra }) as LocalFinancials;
const CASH = { paymentMethod: "cash" as const };
const TB = { id: "cash", name: "Cash", paymentMethod: "cash" as const, startingBalance: 1000, startingDate: "2026-09-01", currency: "USD" as const };
const ym = "2026-10" as never;
const OCT31 = new Date("2026-10-31");
const exchange = (date: string, paid: number, received: number, paidCurrency: "USD" | "LBP" = "USD") =>
  buildExchange({ date, paid, paidCurrency, from: CASH, code: "EUR", received, description: "Exchange to EUR" }, RATE);
const at = (iso: string) => new Date(iso);

describe("the currency code", () => {
  it("three capitals, never USD or LBP", () => {
    expect(["EUR", "GBP", "TRY"].every(isValidForeignCode)).toBe(true);
    expect(["USD", "LBP", "eur", "EU", "EURO", "€"].some(isValidForeignCode)).toBe(false);
  });
});

describe("an exchange", () => {
  it("is one Wants row, category Travel, on the pool the money left, naming the euros received", () => {
    const row = exchange("2026-10-03", 500, 460);
    expect(row).toMatchObject({ amount: 500, currency: "USD", bucket: "WANTS", category: "travel", paymentMethod: "cash", date: "2026-10-03", description: "Exchange to EUR", fx: { code: "EUR", amount: 460, kind: "exchange" } });
    expect(row.linkedPaymentId).toBeUndefined();
    expect(row.fx).not.toHaveProperty("costPerUnitUSD");
  });

  it("carries its trip when one is given", () => {
    expect(buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: CASH, code: "EUR", received: 460, description: "Exchange to EUR", tripId: "trip-lis" }, RATE).tripId).toBe("trip-lis");
  });

  it("counts as Wants spending in its cycle at the amount paid, and its pool falls by it", () => {
    const before = data([], { trackedBalances: [TB] });
    const after = data([exchange("2026-10-03", 500, 460)], { trackedBalances: [TB] });
    expect(periodTotals(after, ym, OCT31).wants - periodTotals(before, ym, OCT31).wants).toBe(500);
    expect(trackedBalanceExpected(TB, before) - trackedBalanceExpected(TB, after)).toBe(500);
  });

  it("paid in lira: it counts at the period's rate", () => {
    const d = data([exchange("2026-10-03", 44_750_000, 460, "LBP")]);
    expect(periodTotals(d, ym, OCT31).wants).toBeCloseTo(500, 2);
  });
});

describe("changing euros back", () => {
  const back = () => buildChangeBack({ date: "2026-10-21", code: "EUR", given: 100, received: 105, receivedCurrency: "USD", to: CASH, description: "Changed back from EUR" }, RATE);

  it("is one reimbursement-shaped row: a TRANSFER that gained what was received, category Travel, on the pool it went to, naming the euros given back", () => {
    expect(back()).toMatchObject({ amount: 105, currency: "USD", bucket: "TRANSFER", category: "travel", paymentMethod: "cash", date: "2026-10-21", fx: { code: "EUR", amount: 100, kind: "back" } });
  });

  it("€100 changed back for $105: Wants spent falls by $105 in its month; income and the budget targets don't move; the pool rises by $105", () => {
    const ex = exchange("2026-10-03", 500, 460);
    const before = data([ex], { trackedBalances: [TB], income: 3000 });
    const after = data([ex, back()], { trackedBalances: [TB], income: 3000 });
    expect(periodTotals(after, ym, OCT31).wants - periodTotals(before, ym, OCT31).wants).toBe(-105);
    expect(periodTotals(after, ym, OCT31).income).toBe(periodTotals(before, ym, OCT31).income);
    expect(computeDashboard(after).budgetTargets).toEqual(computeDashboard(before).budgetTargets);
    expect(trackedBalanceExpected(TB, after) - trackedBalanceExpected(TB, before)).toBe(105);
  });
});

describe("the sheet", () => {
  const ex1 = { ...exchange("2026-10-03", 500, 460), createdAt: "2026-10-03T09:00:00.000Z" };
  const dinner = buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-10-05", description: "Dinner", category: "dining", tripId: "trip-lis" }, at("2026-10-05T20:00:00.000Z"));
  const gift = buildForeignEntry({ kind: "in", code: "EUR", amount: 20, date: "2026-10-06", description: "Ana paid me back" }, at("2026-10-06T10:00:00.000Z"));
  const back = { ...buildChangeBack({ date: "2026-10-21", code: "EUR", given: 100, received: 105, receivedCurrency: "USD", to: CASH, description: "Changed back from EUR" }, RATE), createdAt: "2026-10-21T09:00:00.000Z" };

  it("a sheet entry has its own id, kind, code, amount, date, description, category and trip, and when it was made", () => {
    expect(dinner).toEqual({ id: expect.any(String), kind: "spend", code: "EUR", amount: 40, date: "2026-10-05", description: "Dinner", category: "dining", tripId: "trip-lis", createdAt: "2026-10-05T20:00:00.000Z", updatedAt: "2026-10-05T20:00:00.000Z" });
  });

  it("lists exchanges in, spends out, cash received in and euros changed back out, by date, with a running balance", () => {
    const s = sheet(data([back, ex1], { foreignEntries: [gift, dinner] }), "EUR");
    expect(s.lines.map((l) => [l.source, l.date, l.delta, l.balance])).toEqual([
      ["exchange", "2026-10-03", 460, 460],
      ["spend", "2026-10-05", -40, 420],
      ["in", "2026-10-06", 20, 440],
      ["back", "2026-10-21", -100, 340],
    ]);
    expect(s.balance).toBe(340);
    expect(s.lines[1]).toMatchObject({ id: dinner.id, description: "Dinner", category: "dining", tripId: "trip-lis" });
  });

  it("a deleted exchange or change-back leaves the sheet; a balance can go below zero", () => {
    const d = data([softDelete(data([]), ex1, "2026-10-07T00:00:00.000Z")], { foreignEntries: [dinner] });
    expect(sheet(d, "EUR").balance).toBe(-40);
  });

  it("through a date, one entry left out: the balance held then (for the form's warning)", () => {
    const d = data([ex1], { foreignEntries: [dinner] });
    expect(sheet(d, "EUR", { through: "2026-10-04" }).balance).toBe(460);
    expect(sheet(d, "EUR", { excludeId: dinner.id }).balance).toBe(460);
  });

  it("one sheet per currency code, in order", () => {
    const gbp = buildForeignEntry({ kind: "in", code: "GBP", amount: 50, date: "2026-10-01", description: "Left over" }, at("2026-10-01T09:00:00.000Z"));
    expect(sheetCodes(data([ex1], { foreignEntries: [gbp] }))).toEqual(["EUR", "GBP"]);
    expect(sheetCodes(data([]))).toEqual([]);
  });
});

// Session 19, item 3: a sheet entry is editable like any row: its description,
// category, trip, amount and date. Its id, kind, code and creation time stay;
// its edit time moves (an ordinary change to the sync merge); the balance is
// derived, so it recalculates. Refused like a row: no positive amount, or no
// description. An entry that's gone isn't brought back.
describe("editing a sheet entry", () => {
  const ex1 = { ...exchange("2026-10-03", 500, 460), createdAt: "2026-10-03T09:00:00.000Z" };
  const dinner = buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-10-05", description: "Dinner", category: "dining", tripId: "trip-lis" }, at("2026-10-05T20:00:00.000Z"));
  const p = { amount: 40, description: "Dinner", date: "2026-10-05" };

  it("changes its description, category, trip, amount and date; keeps its id, kind, code and creation time; the balance recalculates", () => {
    const d = data([ex1], { foreignEntries: [dinner] });
    const r = editForeignEntry(d, dinner.id, { amount: 55, description: " Dinner at Ramiro ", date: "2026-10-06", category: "travel", tripId: "trip-rome" }, at("2026-10-07T09:00:00.000Z"));
    if (!r.ok) throw new Error("refused");
    expect(r.data.foreignEntries).toEqual([{ ...dinner, amount: 55, description: "Dinner at Ramiro", date: "2026-10-06", category: "travel", tripId: "trip-rome", updatedAt: "2026-10-07T09:00:00.000Z" }]);
    expect(sheet(r.data, "EUR").balance).toBe(405);
    expect(r.data.transactions).toBe(d.transactions);
  });

  it("clearing its category or trip removes them", () => {
    const r = editForeignEntry(data([], { foreignEntries: [dinner] }), dinner.id, p);
    if (!r.ok) throw new Error("refused");
    expect(r.data.foreignEntries![0]).not.toHaveProperty("category");
    expect(r.data.foreignEntries![0]).not.toHaveProperty("tripId");
  });

  it("is refused like any row: an amount that isn't positive, or no description", () => {
    const d = data([], { foreignEntries: [dinner] });
    expect(editForeignEntry(d, dinner.id, { ...p, amount: 0 })).toEqual({ ok: false, reason: "entry" });
    expect(editForeignEntry(d, dinner.id, { ...p, description: "  " })).toEqual({ ok: false, reason: "entry" });
  });

  it("an entry that's gone isn't brought back", () => {
    const d = data([], { foreignEntries: [] });
    expect(editForeignEntry(d, dinner.id, p)).toEqual({ ok: true, data: d });
  });
});

describe("euro spends touch no budget total, no pool and not net worth", () => {
  it("adding sheet entries changes none of them", () => {
    const base = data([exchange("2026-10-03", 500, 460)], { trackedBalances: [TB] });
    const withSpends = { ...base, foreignEntries: [
      buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-10-05", description: "Dinner", category: "dining" }, at("2026-10-05T20:00:00.000Z")),
      buildForeignEntry({ kind: "in", code: "EUR", amount: 20, date: "2026-10-06", description: "Ana paid me back" }, at("2026-10-06T10:00:00.000Z")),
    ] } as LocalFinancials;
    expect(periodTotals(withSpends, ym, OCT31)).toEqual(periodTotals(base, ym, OCT31));
    expect(trackedBalanceExpected(TB, withSpends)).toBe(trackedBalanceExpected(TB, base));
    expect(computeDashboard(withSpends).netWorth).toEqual(computeDashboard(base).netWorth);
  });
});

it("what a row is to foreign cash: an exchange, a change-back, or neither", () => {
  expect(foreignCashRole(exchange("2026-10-03", 500, 460))).toBe("exchange");
  expect(foreignCashRole(buildChangeBack({ date: "2026-10-21", code: "EUR", given: 100, received: 105, receivedCurrency: "USD", to: CASH, description: "Changed back from EUR" }, RATE))).toBe("back");
  expect(foreignCashRole({ id: "x", amount: 5, currency: "USD", bucket: "WANTS", description: "x", date: "2026-10-03" } as StoredTransaction)).toBeNull();
});
