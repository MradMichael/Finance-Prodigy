// Travel slice 1 (HELD; owner, session 14, with the plan's recommendations
// approved; FIX_PLANS.md "TRAVEL / FOREIGN CASH"). Foreign cash without a
// third currency: the ledger stays in USD and LBP, and a foreign amount is
// an annotation (`fx`) on an ordinary row.
//   - An exchange is two TRANSFER rows, linked: the source leg on the pool
//     the money left, in the currency paid; the pocket leg mirroring it,
//     with `fx: { kind: "in" }` and no payment method. Past dates allowed.
//   - A pocket (one per currency code) is derived from its rows: a balance in
//     that currency and a USD cost basis.
//   - A spend from it is an ordinary USD row at a cost frozen at entry: the
//     pocket's moving average on the spend's date (itself excluded). Short of
//     euros: the latest exchange's rate on or before that date, else none
//     (the form asks). It counts in the monthly budget at that cost.
//   - Pocket rows are never part of a tracked pool, whatever their payment
//     method says; an exchange's source leg is, like any transfer.
//   - An exchange's two rows are deleted, restored and removed together.
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, activeTransactions, softDelete, undeleteTransactions, type LocalFinancials, type StoredTransaction } from "./localData";
import { periodTotals, trackedBalanceExpected } from "./computeDashboard";
import {
  isValidForeignCode, isPocketRow, pocketState, pockets, priceSpend, buildExchange, buildPocketSpend,
  exchangePartnerId, pairedIds, foreignCashRole, foreignCashAtCostUSD,
} from "./foreignCash";

const RATE = 89_500;
const data = (transactions: StoredTransaction[] = [], extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, lbpRate: RATE, lbpRateHistory: [], transactions, ...extra }) as LocalFinancials;
const CASH = { paymentMethod: "cash" as const };
const ex = (date: string, paid: number, received: number, paidCurrency: "USD" | "LBP" = "USD") =>
  buildExchange({ date, paid, paidCurrency, from: CASH, code: "EUR", received, description: "Exchange to EUR" }, RATE);
const spend = (d: LocalFinancials, date: string, amount: number, bucket: "NEEDS" | "WANTS" | "SAVINGS" = "WANTS") => {
  const price = priceSpend(d, "EUR", date);
  if (!price) throw new Error("no price");
  return buildPocketSpend({ date, code: "EUR", amount, bucket, description: "Dinner", costPerUnitUSD: price.costPerUnitUSD });
};

describe("the currency code", () => {
  it("three capitals, never USD or LBP", () => {
    expect(["EUR", "GBP", "TRY"].every(isValidForeignCode)).toBe(true);
    expect(["USD", "LBP", "eur", "EU", "EURO", "€"].some(isValidForeignCode)).toBe(false);
  });
});

describe("an exchange", () => {
  it("is two linked TRANSFER rows: the source leg on its pool, the pocket leg with the euros and no payment method", () => {
    const [src, pocket] = ex("2026-10-02", 500, 460);
    expect(src).toMatchObject({ amount: -500, currency: "USD", bucket: "TRANSFER", paymentMethod: "cash", date: "2026-10-02" });
    expect(src.fx).toBeUndefined();
    expect(pocket).toMatchObject({ amount: 500, currency: "USD", bucket: "TRANSFER", date: "2026-10-02", fx: { code: "EUR", amount: 460, kind: "in" } });
    expect(pocket.paymentMethod).toBeUndefined();
    expect(src.linkedPaymentId).toBeTruthy();
    expect(pocket.linkedPaymentId).toBe(src.linkedPaymentId);
  });

  it("the source pool's expected balance falls by the amount paid; no budget total moves", () => {
    const tb = { id: "cash", name: "Cash", paymentMethod: "cash" as const, startingBalance: 1000, startingDate: "2026-09-01", currency: "USD" as const };
    const before = data([], { trackedBalances: [tb] });
    const after = data(ex("2026-10-02", 500, 460), { trackedBalances: [tb] });
    expect(trackedBalanceExpected(tb, before) - trackedBalanceExpected(tb, after)).toBe(500);
    const ym = "2026-10" as never;
    expect(periodTotals(after, ym, new Date("2026-10-31"))).toEqual(periodTotals(before, ym, new Date("2026-10-31")));
  });

  it("from LBP: the pocket leg mirrors the lira paid, and its basis comes through the cycle's rate", () => {
    const d = data(ex("2026-10-02", 44_750_000, 460, "LBP"));
    expect(pocketState(d, "EUR")).toMatchObject({ balance: 460, basisUSD: 500 });
  });
});

describe("the pocket", () => {
  it("balance and basis after one exchange, and the moving average after two at different rates", () => {
    const one = data(ex("2026-10-02", 500, 460));
    expect(pocketState(one, "EUR")).toEqual({ code: "EUR", balance: 460, basisUSD: 500, averageCostUSD: 500 / 460 });
    const two = data([...ex("2026-10-02", 500, 460), ...ex("2026-10-05", 300, 270)]);
    expect(pocketState(two, "EUR")).toMatchObject({ balance: 730, basisUSD: 800 });
    expect(pocketState(two, "EUR").averageCostUSD).toBeCloseTo(800 / 730, 10);
  });

  it("a spend is priced at the average on its date and frozen: $500 for €460, then €40 costs $43.48", () => {
    const d = data(ex("2026-10-02", 500, 460));
    const s = spend(d, "2026-10-03", 40);
    expect(s).toMatchObject({ amount: 43.48, currency: "USD", bucket: "WANTS", fx: { code: "EUR", amount: 40, kind: "spend" } });
    expect(s.paymentMethod).toBeUndefined();
    expect(pocketState(data([...d.transactions, s]), "EUR")).toMatchObject({ balance: 420, basisUSD: 456.52 });
  });

  it("after two exchanges at different rates, a spend is priced at the average, not the latest rate", () => {
    const d = data([...ex("2026-10-02", 500, 460), ...ex("2026-10-05", 300, 270)]);
    const s = spend(d, "2026-10-06", 100);
    expect(s.fx!.costPerUnitUSD).toBeCloseTo(800 / 730, 10);
    expect(s.amount).toBe(109.59);
  });

  it("an exchange backdated before a spend doesn't re-price it; the remaining basis takes the difference", () => {
    const d = data(ex("2026-10-02", 500, 460));
    const s = spend(d, "2026-10-03", 40);
    const later = data([...d.transactions, s, ...ex("2026-10-01", 100, 80)]);
    expect(later.transactions.find((t) => t.id === s.id)!.amount).toBe(43.48);
    expect(pocketState(later, "EUR")).toMatchObject({ balance: 500, basisUSD: 556.52 });
  });

  it("conservation, to the cent: basis in = spends at cost + remaining basis, through deletes and restores", () => {
    let d = data(ex("2026-10-02", 500, 460));
    const s1 = spend(d, "2026-10-03", 40); d = data([...d.transactions, s1]);
    const s2 = spend(d, "2026-10-04", 33.3); d = data([...d.transactions, s2]);
    const check = (x: LocalFinancials) => {
      const spent = activeTransactions(x.transactions).filter((t) => t.fx?.kind === "spend").reduce((a, t) => a + t.amount, 0);
      expect(Math.round((spent + pocketState(x, "EUR").basisUSD) * 100) / 100).toBe(500);
    };
    check(d);
    const deleted = data(d.transactions.map((t) => (t.id === s1.id ? softDelete(d, t, "2026-10-05T00:00:00.000Z") : t)));
    check(deleted);
    expect(pocketState(deleted, "EUR").balance).toBe(426.7);
    check(undeleteTransactions(deleted, [s1.id], "2026-10-06T00:00:00.000Z"));
  });

  it("short of euros: the latest exchange's rate on or before the date; with none, no price (the form asks)", () => {
    const d = data([...ex("2026-10-02", 500, 460), buildPocketSpend({ date: "2026-10-03", code: "EUR", amount: 460, bucket: "WANTS", description: "All of it", costPerUnitUSD: 500 / 460 })]);
    expect(priceSpend(d, "EUR", "2026-10-04")).toEqual({ costPerUnitUSD: 500 / 460, source: "lastExchange" });
    expect(priceSpend(data(), "EUR", "2026-10-04")).toBeNull();
    expect(priceSpend(data(ex("2026-10-10", 500, 460)), "EUR", "2026-10-04")).toBeNull();
  });

  it("pockets lists each currency held; the foreign cash at cost sums those with a balance", () => {
    const d = data([...ex("2026-10-02", 500, 460), ...buildExchange({ date: "2026-10-02", paid: 130, paidCurrency: "USD", from: CASH, code: "GBP", received: 100, description: "Exchange to GBP" }, RATE)]);
    expect(pockets(d).map((p) => p.code)).toEqual(["EUR", "GBP"]);
    expect(foreignCashAtCostUSD(d)).toBe(630);
    expect(foreignCashAtCostUSD(data())).toBe(0);
  });
});

describe("the budget", () => {
  it("a spend counts in its bucket at its frozen USD cost", () => {
    const d0 = data(ex("2026-10-02", 500, 460));
    const d = data([...d0.transactions, spend(d0, "2026-10-03", 40, "WANTS")]);
    const ym = "2026-10" as never;
    expect(periodTotals(d, ym, new Date("2026-10-31")).wants - periodTotals(d0, ym, new Date("2026-10-31")).wants).toBeCloseTo(43.48, 2);
  });
});

describe("tracked pools", () => {
  it("pocket rows are in no pool, even with a payment method set; the source leg is in its pool", () => {
    const tb = { id: "cash", name: "Cash", paymentMethod: "cash" as const, startingBalance: 1000, startingDate: "2026-09-01", currency: "USD" as const };
    const [src, pocket] = ex("2026-10-02", 500, 460);
    const s = buildPocketSpend({ date: "2026-10-03", code: "EUR", amount: 40, bucket: "WANTS", description: "Dinner", costPerUnitUSD: 500 / 460 });
    const labelled = [src, { ...pocket, paymentMethod: "cash" as const }, { ...s, paymentMethod: "cash" as const }];
    expect(trackedBalanceExpected(tb, data(labelled, { trackedBalances: [tb] }))).toBe(500);
    expect(isPocketRow(src)).toBe(false);
    expect(isPocketRow(pocket) && isPocketRow(s)).toBe(true);
  });
});

describe("an exchange's two rows go together", () => {
  it("each leg names the other; a spend and an ordinary transfer have no partner", () => {
    const [src, pocket] = ex("2026-10-02", 500, 460);
    const all = [src, pocket];
    expect(exchangePartnerId(all, src)).toBe(pocket.id);
    expect(exchangePartnerId(all, pocket)).toBe(src.id);
    expect(pairedIds(all, src.id).sort()).toEqual([src.id, pocket.id].sort());
    const s = buildPocketSpend({ date: "2026-10-03", code: "EUR", amount: 40, bucket: "WANTS", description: "Dinner", costPerUnitUSD: 1.1 });
    const transferA = { ...src, id: "a", linkedPaymentId: "L", fx: undefined };
    const transferB = { ...src, id: "b", linkedPaymentId: "L", amount: 500, fx: undefined };
    expect(pairedIds([...all, s, transferA, transferB], s.id)).toEqual([s.id]);
    expect(pairedIds([transferA, transferB], "a")).toEqual(["a"]);
  });

  it("roles: an exchange leg, a spend, or none", () => {
    const [src, pocket] = ex("2026-10-02", 500, 460);
    const s = buildPocketSpend({ date: "2026-10-03", code: "EUR", amount: 40, bucket: "WANTS", description: "Dinner", costPerUnitUSD: 1.1 });
    const all = [src, pocket, s];
    expect([foreignCashRole(src, all), foreignCashRole(pocket, all), foreignCashRole(s, all)]).toEqual(["exchange", "exchange", "spend"]);
    expect(foreignCashRole({ ...src, id: "x", linkedPaymentId: undefined }, all)).toBeNull();
  });

  it("restoring several rows uses one restore generation", () => {
    const [src, pocket] = ex("2026-10-02", 500, 460);
    let d = data([src, pocket]);
    d = data(d.transactions.map((t) => softDelete(d, t, "2026-10-05T00:00:00.000Z")));
    const r = undeleteTransactions(d, [src.id, pocket.id], "2026-10-06T00:00:00.000Z");
    expect(activeTransactions(r.transactions)).toHaveLength(2);
    expect(r.revivedKeys?.transactions?.[src.id]).toBe(r.revivedKeys?.transactions?.[pocket.id]);
  });
});
