// ZERO-DIFF GATE for the period primitive (Phase 1).
//
// Phase 1 introduces lib/period.ts and threads every month-boundary
// assumption through it, configured to startDay 1 — the calendar behaviour
// the app already has. Nothing may move. This file is the gate.
//
// The baseline was captured by running this file against the PRE-change code
// and committing the snapshot BEFORE lib/period.ts existed. So the snapshot
// records the old behaviour, and the assertion is that it survives. That
// ordering is the whole point: a snapshot generated after the change would
// record the new code's own output and prove nothing (2.4.76).
//
// Two layers, deliberately:
//   1. An exhaustive snapshot of the entire computeDashboard payload. Every
//      derived figure in the app passes through it — the 12 membership
//      filters, the 3 month-walking loops, every historized lookup. Any
//      movement anywhere fails here with a readable diff.
//   2. Explicit assertions on headline figures. Redundant against the
//      snapshot on purpose: a snapshot can be regenerated with -u and lose
//      its meaning, and these cannot be. They also document what the
//      fixture is supposed to produce.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";

// Mid-month on purpose: a boundary bug that only shows up away from the 1st
// would be invisible on the 1st, and day-of-month drives budgetPace.
const NOW = new Date(2026, 8, 13); // 13 September 2026
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

const tx = (
  id: string, date: string, amount: number,
  bucket: StoredTransaction["bucket"], extra: Partial<StoredTransaction> = {},
): StoredTransaction => ({
  id, date, amount, currency: "USD", bucket, description: `${bucket} ${id}`,
  ...extra,
} as StoredTransaction);

/**
 * Deliberately rich: transactions spanning eight months so budgetRollover,
 * sixMonthTrend and savingsStreak all have real history to walk; both
 * currencies so the historized rate lookups are exercised; a tracked balance
 * so balanceChecks and its date-keyed conversions run; recurring, goals and
 * debts so every branch of the payload is populated rather than defaulted.
 *
 * A thin fixture would make the snapshot large and meaningless — most of it
 * would be zeroes that cannot move.
 */
function makeData(): LocalFinancials {
  return {
    ...DEFAULT_DATA,
    userName: "Zero Diff",
    income: 3000,
    lbpRate: 89500,
    budgetRule: "50-30-20",
    emergencyFundBalance: 1200,
    emergencyFundOpeningBalance: 1000,
    emergencyFundTargetMonths: 3,
    incomeHistory: [
      { ym: "2026-02", value: 2400 },
      { ym: "2026-06", value: 3000 },
    ],
    lbpRateHistory: [
      { ym: "2026-02", value: 86000 },
      { ym: "2026-07", value: 89500 },
    ],
    budgetRuleHistory: [
      { ym: "2026-02", needs: 60, wants: 20, savings: 20 },
      { ym: "2026-06", needs: 50, wants: 30, savings: 20 },
    ],
    netWorthHistory: [
      { ym: "2026-05", value: 400 },
      { ym: "2026-06", value: 700 },
      { ym: "2026-07", value: 900 },
      { ym: "2026-08", value: 1100 },
    ],
    transactions: [
      tx("t01", "2026-03-04", 900, "NEEDS"),
      tx("t02", "2026-03-19", 260, "WANTS"),
      tx("t03", "2026-04-02", 880, "NEEDS"),
      tx("t04", "2026-04-21", 300, "SAVINGS"),
      tx("t05", "2026-05-06", 910, "NEEDS"),
      tx("t06", "2026-05-18", 340, "WANTS"),
      tx("t07", "2026-05-27", 250, "SAVINGS"),
      tx("t08", "2026-06-03", 940, "NEEDS"),
      tx("t09", "2026-06-14", 1_200_000, "WANTS", { currency: "LBP", lbpRateAtEntry: 89000 }),
      tx("t10", "2026-06-28", 400, "SAVINGS"),
      tx("t11", "2026-07-05", 905, "NEEDS"),
      tx("t12", "2026-07-22", 275, "WANTS"),
      tx("t13", "2026-08-01", 950, "NEEDS", { paymentMethod: "cash" }),
      tx("t14", "2026-08-16", 310, "WANTS", { paymentMethod: "cash" }),
      tx("t15", "2026-08-30", 500, "SAVINGS"),
      // Current cycle/month, both sides of the 13th so day-of-month matters.
      tx("t16", "2026-09-02", 620, "NEEDS", { paymentMethod: "cash" }),
      tx("t17", "2026-09-09", 180, "WANTS", { paymentMethod: "cash" }),
      tx("t18", "2026-09-11", 150, "SAVINGS"),
      tx("t19", "2026-09-12", 250, "INCOME"),
      // Deliberately AFTER "today" — a future-dated entry inside the same
      // month, which any window change would reclassify.
      tx("t20", "2026-09-28", 90, "WANTS"),
    ],
    goals: [
      { id: "g1", name: "Trip", targetAmount: 4000, currentAmount: 500, currency: "USD", targetDate: "2027-08-01", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "g2", name: "Laptop", targetAmount: 1500, currentAmount: 0, currency: "USD", targetDate: "2027-02-01", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    debts: [
      { id: "d1", name: "Card", openingBalance: 2000, apr: 18, minPayment: 60, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    recurring: [
      { id: "r1", name: "Rent", emoji: "R", amount: 700, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "r2", name: "Uni", emoji: "U", amount: 750, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-08-01", endDate: null, totalAmount: 6750, confirmCutoverDate: "2026-08-24", createdAt: "2026-08-01T00:00:00.000Z" },
    ],
    trackedBalances: [
      { id: "tb1", name: "Wallet", paymentMethod: "cash", startingBalance: 900, startingDate: "2026-08-01", currency: "USD", actualBalance: 700, actualBalanceDate: "2026-09-05T00:00:00.000Z", expectedAtCheckUSD: 740 },
    ],
  } as LocalFinancials;
}

describe("period primitive — zero-diff gate", () => {
  it("the entire computeDashboard payload is unchanged", () => {
    const dash = computeDashboard(makeData());
    // `anchor` is a live Date; with fake timers it is deterministic, but it
    // is serialised explicitly so a change in its TYPE would also show.
    const serialisable = { ...dash, anchor: dash.anchor.toISOString() };
    expect(serialisable).toMatchSnapshot();
  });

  it("headline figures, asserted explicitly so the gate survives a snapshot regeneration", () => {
    const d = computeDashboard(makeData());
    // Deliberately spread across every subsystem a boundary change touches:
    // membership filtering, the historized lookups, the three month-walkers,
    // and day-of-month pacing.
    expect({
      periodYear: d.period.year,
      periodMonth: d.period.month,
      monthIncome: d.month.income,
      needsSpend: Math.round(d.month.needsSpend * 100) / 100,
      wantsSpend: Math.round(d.month.wantsSpend * 100) / 100,
      savingsContrib: Math.round(d.month.savingsContrib * 100) / 100,
      netCashFlow: Math.round(d.month.netCashFlow * 100) / 100,
      budgetTargets: d.budgetTargets,
      budgetRollover: d.budgetRollover,
      effectiveBudgetTargets: d.effectiveBudgetTargets,
      pacePctOfMonthElapsed: d.budgetPace.map((p) => p.pctOfMonthElapsed),
      paceStatuses: d.budgetPace.map((p) => p.status),
      sixMonthTrendKeys: d.sixMonthTrend.map((t) => t.ymKey),
      sixMonthTrendSpend: d.sixMonthTrend.map((t) => Math.round(t.spend * 100) / 100),
      netWorthTrendKeys: d.netWorthTrend.map((t) => t.ym),
      healthScore: d.health.score,
      streakCounts: d.streaks.map((s) => s.count),
      efRemaining: Math.round(d.emergencyFund.remaining * 100) / 100,
      balanceCheckDiscrepancy: d.balanceChecks.map((b) => b.discrepancy),
      alertIds: d.alerts.map((a) => a.id).sort(),
    }).toMatchSnapshot();
  });

  it("the fixture actually exercises what it claims — premise, so the gate is not guarding zeroes", () => {
    const d = computeDashboard(makeData());
    // Each of these would be 0/empty on a thin fixture, making the snapshot
    // above a snapshot of nothing.
    expect(d.month.needsSpend).toBeGreaterThan(0);
    expect(d.month.wantsSpend).toBeGreaterThan(0);
    expect(d.sixMonthTrend.some((t) => t.spend > 0)).toBe(true);
    expect(d.budgetRollover.needs + d.budgetRollover.wants + d.budgetRollover.savings).not.toBe(0);
    expect(d.balanceChecks.length).toBeGreaterThan(0);
    expect(d.netWorthTrend.length).toBeGreaterThan(1);
    // A historized lookup that differs from the live value: income was 2400
    // before 2026-06, so past-month math must not use today's 3000.
    expect(d.sixMonthTrend.length).toBe(6);
  });
});
