// T2 (session 32 review; owner, session 33, DECISIONS_PENDING 13 (b)): "Salary paid into". Each payday after
// the chosen balance's baseline day adds that cycle's Setup income to the balance's expected figure, and
// touches no income figure. One implementation, through every expected-balance entry point.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboard, salaryCreditUSD, trackedBalanceExpected, trackedBalanceExpectedAsOf, trackedBalanceNowOf } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type TrackedBalance } from "./localData";
import { asCycleKey } from "./period";
import { settingValue } from "./syncSeen";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-12-15T12:00:00")); });
afterEach(() => vi.useRealTimers());

const visa: TrackedBalance = { id: "tb-visa", name: "Visa •••• 4821", paymentMethod: "card", cardId: "c1", startingBalance: 500, startingDate: "2026-10-01", startingAt: new Date("2026-10-01T09:00:00").toISOString(), currency: "USD" };
const cash: TrackedBalance = { id: "tb-cash", name: "Cash", paymentMethod: "cash", startingBalance: 200, startingDate: "2026-10-01", startingAt: new Date("2026-10-01T09:00:00").toISOString(), currency: "USD" };

function data(over: Partial<LocalFinancials> = {}): LocalFinancials {
  return {
    ...DEFAULT_DATA,
    income: 3200,
    trackedBalances: [visa, cash],
    transactions: [{ id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Groceries", date: "2026-11-10", paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 4821", createdAt: new Date("2026-11-10T10:00:00").toISOString() }],
    ...over,
  } as LocalFinancials;
}
const expectedOf = (d: LocalFinancials, id: string) => computeDashboard(d).balanceChecks.find((b) => b.id === id)!.expected;

describe("salary paid into a balance", () => {
  it("without the setting, nothing changes", () => {
    expect(expectedOf(data(), "tb-visa")).toBe(400);
  });

  it("each payday after the baseline day adds that cycle's income; the baseline day itself doesn't", () => {
    // Paydays 1 Nov and 1 Dec; 1 Oct is the baseline day, taken as already holding its salary.
    expect(expectedOf(data({ salaryIntoBalanceId: "tb-visa" }), "tb-visa")).toBe(400 + 3200 * 2);
    expect(salaryCreditUSD(visa, data({ salaryIntoBalanceId: "tb-visa" }), "2026-12-15")).toBe(6400);
  });

  it("an income change credits each cycle its own income", () => {
    const d = data({ salaryIntoBalanceId: "tb-visa", incomeHistory: [{ ym: asCycleKey("2026-10"), value: 3200 }, { ym: asCycleKey("2026-12"), value: 3500 }], income: 3500 });
    expect(expectedOf(d, "tb-visa")).toBe(400 + 3200 + 3500);
  });

  it("follows the payday setting: on the 25th", () => {
    vi.setSystemTime(new Date("2026-11-30T12:00:00"));
    const tb = { ...visa, startingDate: "2026-10-10", startingAt: new Date("2026-10-10T09:00:00").toISOString() };
    const d = data({ salaryIntoBalanceId: "tb-visa", cycleStartDay: 25, trackedBalances: [tb, cash] });
    expect(salaryCreditUSD(tb, d, "2026-11-30")).toBe(3200 * 2); // 25 Oct and 25 Nov
    expect(salaryCreditUSD(tb, d, "2026-11-24")).toBe(3200); // before 25 Nov: 25 Oct only
  });

  it("only the chosen balance is credited", () => {
    expect(expectedOf(data({ salaryIntoBalanceId: "tb-visa" }), "tb-cash")).toBe(200);
  });

  it("the close's figure stops at its own cut-off day", () => {
    const d = data({ salaryIntoBalanceId: "tb-visa" });
    expect(trackedBalanceExpectedAsOf(visa, d, new Date("2026-11-30T23:59:59").toISOString())).toBe(500 + 3200 - 100);
  });

  it("the statement import's and the holdings' figures agree with Balance Check's", () => {
    const d = data({ salaryIntoBalanceId: "tb-visa" });
    expect(trackedBalanceExpected(visa, d)).toBe(6800);
    expect(trackedBalanceNowOf(visa, d).native).toBe(6800);
  });

  it("a lira balance: the dollars credited, read in lira like every row", () => {
    const lira: TrackedBalance = { ...visa, id: "tb-lira", currency: "LBP", startingBalance: 44_750_000 };
    const d = data({ salaryIntoBalanceId: "tb-lira", trackedBalances: [lira], transactions: [] });
    const bc = computeDashboard(d).balanceChecks.find((b) => b.id === "tb-lira")!;
    expect(bc.expected).toBe(500 + 6400);
    expect(bc.nowNative).toBe((500 + 6400) * 89500);
  });

  it("no income figure moves", () => {
    const without = computeDashboard(data());
    const withIt = computeDashboard(data({ salaryIntoBalanceId: "tb-visa" }));
    expect(withIt.month.income).toBe(without.month.income);
    expect(withIt.month.netCashFlow).toBe(without.month.netCashFlow);
  });

  it("syncs as part of the income setting", () => {
    expect(settingValue(data({ salaryIntoBalanceId: "tb-visa" }), "income")).toEqual({ income: 3200, salaryIntoBalanceId: "tb-visa" });
  });
});
