// Income history before the first snapshot (owner, session 41; docs/plans/phase-2.8.md, "Income-history
// fallback"). The app records the month's income once a cycle while it's open. A cycle before the first
// record (entries imported from before, or an account older than the history) used to take TODAY's income,
// so a raise rewrote every such month. It now takes the EARLIEST recorded income, the figure closest to it.
// With no history at all, it is still today's income. Only income: the LBP rate keeps its own rule.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboard, periodTotals, salaryCreditUSD } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";
import { asCycleKey } from "./period";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 6, 15, 12)); }); // 15 July 2026
afterEach(() => vi.useRealTimers());

const MARCH_GROCERIES: StoredTransaction = { id: "t-mar", amount: 50, currency: "USD", bucket: "NEEDS", description: "Groceries", date: "2026-03-10", paymentMethod: "cash" } as StoredTransaction;
// Income was first recorded in May, at $3,000; a raise to $3,200 was recorded in July.
const FROM_MAY = [{ ym: asCycleKey("2026-05"), value: 3000 }, { ym: asCycleKey("2026-07"), value: 3200 }];

function data(over: Partial<LocalFinancials> = {}): LocalFinancials {
  return { ...DEFAULT_DATA, income: 3200, budgetRule: "50-30-20", incomeHistory: FROM_MAY, transactions: [MARCH_GROCERIES], ...over } as LocalFinancials;
}

describe("a cycle before the first income record takes the earliest record", () => {
  it("the six-month trend: February to April at $3,000, not today's $3,200", () => {
    // The trend shows a month's income only when the month has spending, so each month gets an entry.
    const monthly = ["02", "04", "05", "06"].map((m) => ({ ...MARCH_GROCERIES, id: `t-${m}`, date: `2026-${m}-10` }));
    const trend = computeDashboard(data({ transactions: [MARCH_GROCERIES, ...monthly] })).sixMonthTrend;
    const income = (ymKey: number) => trend.find((t) => t.ymKey === ymKey)!.income;
    expect(income(202602)).toBe(3000);
    expect(income(202603)).toBe(3000);
    expect(income(202604)).toBe(3000);
    expect(income(202605)).toBe(3000); // the first record itself, as before
    expect(income(202606)).toBe(3000); // between records, as before
  });

  it("a past month's totals (the Overview's review and Statistics): March's income is $3,000", () => {
    expect(periodTotals(data(), asCycleKey("2026-03"), new Date(2026, 2, 1)).income).toBe(3000);
  });

  it("budget rollover judges March against $3,000, as if March had its own record", () => {
    const withMarchRecord = data({ incomeHistory: [{ ym: asCycleKey("2026-03"), value: 3000 }, ...FROM_MAY] });
    expect(computeDashboard(data()).budgetRollover).toEqual(computeDashboard(withMarchRecord).budgetRollover);
  });

  it("salary paid into a balance credits the earliest record on a payday before it", () => {
    const tb = { id: "tb-cash", startingDate: "2026-03-01" };
    const d = data({
      salaryIntoBalanceId: "tb-cash",
      trackedBalances: [{ id: "tb-cash", name: "Cash", paymentMethod: "cash", startingBalance: 0, startingDate: "2026-03-01", startingAt: new Date(2026, 2, 1, 9).toISOString(), currency: "USD" }],
    });
    // Paydays 1 Apr, 1 May, 1 Jun and 1 Jul: April before the first record ($3,000), then $3,000, $3,000, $3,200.
    expect(salaryCreditUSD(tb, d, "2026-07-15")).toBe(3000 + 3000 + 3000 + 3200);
  });
});

describe("unchanged", () => {
  it("with no income history at all, a past month takes today's income", () => {
    expect(periodTotals(data({ incomeHistory: [] }), asCycleKey("2026-03"), new Date(2026, 2, 1)).income).toBe(3200);
    expect(periodTotals(data({ incomeHistory: undefined }), asCycleKey("2026-03"), new Date(2026, 2, 1)).income).toBe(3200);
  });

  it("the LBP rate keeps its own rule: a cycle before its first record takes today's rate", () => {
    const lira = { id: "t-lbp", amount: 1_000_000, currency: "LBP", bucket: "NEEDS", description: "Generator", date: "2026-03-12", paymentMethod: "cash" } as StoredTransaction;
    const d = data({ transactions: [lira], lbpRate: 100_000, lbpRateHistory: [{ ym: asCycleKey("2026-05"), value: 90_000 }] });
    expect(periodTotals(d, asCycleKey("2026-03"), new Date(2026, 2, 1)).needs).toBeCloseTo(10, 6); // at 100,000, not 90,000
  });
});
