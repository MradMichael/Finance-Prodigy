import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type BudgetRuleKey } from "./localData";

function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return { ...DEFAULT_DATA, ...overrides };
}

// Pinned mid-month so daysElapsed(15) clears MIN_DAYS_FOR_PROJECTION(10) and
// daysInMonth(31, July) gives clean percentages — every test that cares about
// "now" relies on this unless it explicitly re-pins a different date.
const NOW = new Date(2026, 6, 15); // July 15, 2026

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("budget rules", () => {
  const rules: BudgetRuleKey[] = ["40-30-30", "50-30-20", "60-20-20", "70-20-10", "80-15-5"];
  it.each(rules)("computes budgetTargets for %s from income", (rule) => {
    const data = makeData({ income: 1000, budgetRule: rule });
    const result = computeDashboard(data);
    const sum = result.budgetTargets.needs + result.budgetTargets.wants + result.budgetTargets.savings;
    expect(sum).toBeCloseTo(1000, 5);
    expect(result.budgetRule).toBe(rule);
  });

  it("custom rule uses budgetCustomNeeds/Wants and derives savings as the remainder", () => {
    const data = makeData({ income: 1000, budgetRule: "custom", budgetCustomNeeds: 60, budgetCustomWants: 30 });
    const result = computeDashboard(data);
    expect(result.budgetTargets.needs).toBeCloseTo(600, 5);
    expect(result.budgetTargets.wants).toBeCloseTo(300, 5);
    expect(result.budgetTargets.savings).toBeCloseTo(100, 5);
  });

  it("custom rule with needs+wants > 100 produces a negative savings target (documents current behavior, not necessarily desired)", () => {
    const data = makeData({ income: 1000, budgetRule: "custom", budgetCustomNeeds: 70, budgetCustomWants: 50 });
    const result = computeDashboard(data);
    // 100 - 70 - 50 = -20% of income
    expect(result.budgetTargets.savings).toBeCloseTo(-200, 5);
    // effectiveBudgetTargets floors at 0 regardless of the raw (possibly negative) target
    expect(result.effectiveBudgetTargets.savings).toBeGreaterThanOrEqual(0);
  });
});

describe("health score", () => {
  it("component weights always sum to 100", () => {
    const data = makeData({ income: 3000 });
    const result = computeDashboard(data);
    const totalWeight = result.health.components.reduce((s, c) => s + c.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it("score is a weighted sum of the components (within rounding)", () => {
    const data = makeData({ income: 3000, emergencyFundBalance: 3000, emergencyFundTargetMonths: 1 });
    const result = computeDashboard(data);
    const bySum = result.health.components.reduce((s, c) => s + (c.score * c.weight) / 100, 0);
    expect(result.health.score).toBeCloseTo(bySum, 0);
  });

  it("grade matches the documented thresholds", () => {
    // Full EF, no debt, needs well under target, and a savings transaction
    // meeting the 20% target this month should land in the top grade.
    // (No goals -> goalScore defaults to 50, capping the max achievable score.)
    const data = makeData({
      income: 3000, emergencyFundBalance: 100000, emergencyFundTargetMonths: 1,
      transactions: [{ id: "t1", amount: 600, currency: "USD", bucket: "SAVINGS", description: "Savings", date: "2026-07-01" }],
    });
    const result = computeDashboard(data);
    expect(result.health.score).toBeGreaterThanOrEqual(80);
    expect(result.health.grade).toBe("Thriving");
  });
});

describe("net worth tiers", () => {
  const cases: { assets: number; debtBalance: number; expectedTier: string; expectedColor: string }[] = [
    { assets: 0, debtBalance: 25000, expectedTier: "Heavy debt load", expectedColor: "coral" },
    { assets: 0, debtBalance: 10000, expectedTier: "Rebuilding", expectedColor: "coral" },
    { assets: 200, debtBalance: 2000, expectedTier: "Closing the gap", expectedColor: "brass" },
    { assets: 4000, debtBalance: 5000, expectedTier: "Almost positive", expectedColor: "brass" },
    { assets: 3000, debtBalance: 0, expectedTier: "Breaking even", expectedColor: "brass" },
    { assets: 10000, debtBalance: 0, expectedTier: "Foundation builder", expectedColor: "jade" },
    { assets: 50000, debtBalance: 0, expectedTier: "Growing wealth", expectedColor: "jade" },
    { assets: 150000, debtBalance: 0, expectedTier: "Wealth building", expectedColor: "jade" },
  ];
  it.each(cases)("nw=$assets-$debtBalance -> $expectedTier", ({ assets, debtBalance, expectedTier, expectedColor }) => {
    const data = makeData({
      income: 3000,
      emergencyFundBalance: assets,
      debts: debtBalance > 0 ? [{ id: "d1", name: "Loan", balance: debtBalance, apr: 10, minPayment: 100, createdAt: NOW.toISOString() }] : [],
    });
    const result = computeDashboard(data);
    expect(result.netWorth.tier).toBe(expectedTier);
    expect(result.netWorth.tierColor).toBe(expectedColor);
  });
});

describe("debt plan", () => {
  it("is null when there are no debts", () => {
    const result = computeDashboard(makeData({ income: 3000 }));
    expect(result.debt.plan).toBeNull();
    expect(result.debt.comparison).toBeNull();
  });

  it("is infeasible when the monthly commitment doesn't cover interest", () => {
    const data = makeData({
      income: 100, // tiny income -> tiny/no extra payment
      debts: [{ id: "d1", name: "Huge APR loan", balance: 10000, apr: 99, minPayment: 1, createdAt: NOW.toISOString() }],
    });
    const result = computeDashboard(data);
    expect(result.debt.plan?.feasible).toBe(false);
    expect(result.debt.plan?.warning).toBeTruthy();
  });

  it("feasible plan produces a comparison where avalanche never has more total interest than snowball on the same inputs", () => {
    const data = makeData({
      income: 5000,
      debts: [
        { id: "d1", name: "Card A", balance: 2000, apr: 24, minPayment: 50, createdAt: NOW.toISOString() },
        { id: "d2", name: "Card B", balance: 500, apr: 8, minPayment: 20, createdAt: NOW.toISOString() },
      ],
    });
    const result = computeDashboard(data);
    expect(result.debt.plan?.feasible).toBe(true);
    expect(result.debt.comparison).not.toBeNull();
    expect(result.debt.comparison!.avalanche.totalInterest).toBeLessThanOrEqual(result.debt.comparison!.snowball.totalInterest);
    expect(result.debt.comparison!.avalancheSavesVsSnowball).toBeGreaterThanOrEqual(0);
  });
});

describe("budget pace", () => {
  it("flags 'over' once spend reaches the effective target", () => {
    const data = makeData({
      income: 1000, budgetRule: "50-30-20", // needs target = 500
      transactions: [{ id: "t1", amount: 600, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-07-01" }],
    });
    const result = computeDashboard(data);
    const needs = result.budgetPace.find((p) => p.bucket === "NEEDS")!;
    expect(needs.status).toBe("over");
  });

  it("does not claim a specific dollar overage before MIN_DAYS_FOR_PROJECTION", () => {
    vi.setSystemTime(new Date(2026, 6, 2)); // July 2 — daysElapsed=2, below the threshold of 10
    const data = makeData({
      income: 1000, budgetRule: "50-30-20",
      transactions: [{ id: "t1", amount: 400, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-07-01" }],
    });
    const result = computeDashboard(data);
    const needs = result.budgetPace.find((p) => p.bucket === "NEEDS")!;
    expect(needs.status).toBe("watch");
    expect(needs.message).not.toMatch(/\$\d/); // no dollar-figure projection this early
  });

  it("does not claim a specific dollar overage on day 8 of a 31-day month, even at 90% used (regression: a lightly-used bucket with no recurring floor could previously project a bigger overage than a heavily-used one, purely from the day-8 multiplier)", () => {
    vi.setSystemTime(new Date(2026, 7, 8)); // Aug 8, 2026 — daysElapsed=8, daysInMonth=31
    const data = makeData({
      income: 1000, budgetRule: "50-30-20", // needs target = 500, wants target = 300
      transactions: [
        { id: "t1", amount: 450, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-08-01" }, // 90% used
        { id: "t2", amount: 180, currency: "USD", bucket: "WANTS", description: "Shopping", date: "2026-08-02" }, // 60% used
      ],
    });
    const result = computeDashboard(data);
    const needs = result.budgetPace.find((p) => p.bucket === "NEEDS")!;
    const wants = result.budgetPace.find((p) => p.bucket === "WANTS")!;
    expect(needs.message).not.toMatch(/\$\d/);
    expect(wants.message).not.toMatch(/\$\d/);
  });

  it("does claim a specific dollar overage once past MIN_DAYS_FOR_PROJECTION", () => {
    // NOW is July 15 (daysElapsed=15) via the top-level beforeEach.
    const data = makeData({
      income: 1000, budgetRule: "50-30-20", // needs target = 500
      transactions: [{ id: "t1", amount: 300, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-07-01" }],
    });
    const result = computeDashboard(data);
    const needs = result.budgetPace.find((p) => p.bucket === "NEEDS")!;
    // projected = (300/15)*31 = 620 > 500 target -> watch, with a dollar figure
    expect(needs.status).toBe("watch");
    expect(needs.message).toMatch(/\$\d/);
  });

  it("treats SAVINGS as a floor: hitting 100%+ is 'ok', not 'over'", () => {
    const data = makeData({
      income: 1000, budgetRule: "50-30-20", // savings target = 200
      transactions: [{ id: "t1", amount: 500, currency: "USD", bucket: "SAVINGS", description: "Transfer", date: "2026-07-01" }],
    });
    const result = computeDashboard(data);
    const savings = result.budgetPace.find((p) => p.bucket === "SAVINGS")!;
    expect(savings.status).toBe("ok");
  });

  it("floors a rollover-deficit target at 0 instead of going negative", () => {
    // 0%-savings custom rule this month, but a positive-savings month back in
    // January means budgetRollover.savings goes negative -> should floor at 0.
    const data = makeData({
      income: 1000, budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 15, // savings target = 0%
      transactions: [{ id: "t1", amount: 50, currency: "USD", bucket: "SAVINGS", description: "Old saving", date: "2026-01-15" }],
    });
    const result = computeDashboard(data);
    expect(result.effectiveBudgetTargets.savings).toBeGreaterThanOrEqual(0);
    // With $0 spent against a floored (non-negative) target, savings should never read "over".
    const savings = result.budgetPace.find((p) => p.bucket === "SAVINGS");
    if (savings) expect(savings.status).not.toBe("over");
  });
});

describe("upcoming renewals", () => {
  it("includes a recurring item due within the 7-day window", () => {
    const data = makeData({
      recurring: [{
        id: "r1", name: "Netflix", emoji: "🎬", amount: 15, currency: "USD", frequency: "monthly",
        bucket: "WANTS", startDate: "2026-06-20", endDate: null, totalAmount: null, createdAt: "2026-06-20T00:00:00.000Z",
      }],
    });
    const result = computeDashboard(data);
    // Monthly from June 20 -> next occurrence July 20, 5 days after "now" (July 15).
    expect(result.upcomingRenewals).toHaveLength(1);
    expect(result.upcomingRenewals[0].dueInDays).toBe(5);
  });

  it("excludes a recurring item due more than 7 days out", () => {
    const data = makeData({
      recurring: [{
        id: "r1", name: "Annual plan", emoji: "📅", amount: 100, currency: "USD", frequency: "yearly",
        bucket: "WANTS", startDate: "2025-09-01", endDate: null, totalAmount: null, createdAt: "2025-09-01T00:00:00.000Z",
      }],
    });
    const result = computeDashboard(data);
    expect(result.upcomingRenewals).toHaveLength(0);
  });
});

describe("balance checks", () => {
  it("matches cash transactions and ignores card transactions", () => {
    const data = makeData({
      trackedBalances: [{ id: "b1", name: "Wallet", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD" }],
      transactions: [
        { id: "t1", amount: 20, currency: "USD", bucket: "WANTS", description: "Coffee", date: "2026-07-05", paymentMethod: "cash" },
        { id: "t2", amount: 50, currency: "USD", bucket: "WANTS", description: "Shoes", date: "2026-07-06", paymentMethod: "card", cardId: "c1" },
      ],
    });
    const result = computeDashboard(data);
    expect(result.balanceChecks).toHaveLength(1);
    expect(result.balanceChecks[0].expected).toBe(80); // 100 - 20 cash only
  });

  it("matches card transactions only for the same cardId", () => {
    const data = makeData({
      trackedBalances: [{ id: "b1", name: "Visa", paymentMethod: "card", cardId: "c1", startingBalance: 200, startingDate: "2026-07-01", currency: "USD" }],
      transactions: [
        { id: "t1", amount: 30, currency: "USD", bucket: "WANTS", description: "On this card", date: "2026-07-05", paymentMethod: "card", cardId: "c1" },
        { id: "t2", amount: 40, currency: "USD", bucket: "WANTS", description: "Different card", date: "2026-07-06", paymentMethod: "card", cardId: "c2" },
      ],
    });
    const result = computeDashboard(data);
    expect(result.balanceChecks[0].expected).toBe(170); // 200 - 30, c2's tx excluded
  });

  it("computes discrepancy only once an actual balance has been recorded", () => {
    const data = makeData({
      trackedBalances: [{
        id: "b1", name: "Wallet", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD",
        actualBalance: 70, actualBalanceDate: "2026-07-10T00:00:00.000Z",
      }],
      transactions: [{ id: "t1", amount: 20, currency: "USD", bucket: "WANTS", description: "Coffee", date: "2026-07-05", paymentMethod: "cash" }],
    });
    const result = computeDashboard(data);
    // expected = 80, actual = 70 -> discrepancy = -10 (unaccounted for)
    expect(result.balanceChecks[0].discrepancy).toBe(-10);
  });

  it("discrepancy is null when no actual balance has been entered", () => {
    const data = makeData({
      trackedBalances: [{ id: "b1", name: "Wallet", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD" }],
    });
    const result = computeDashboard(data);
    expect(result.balanceChecks[0].actual).toBeNull();
    expect(result.balanceChecks[0].discrepancy).toBeNull();
  });

  it("does not flag a mismatch for a transaction logged after an already-accurate check-in", () => {
    const data = makeData({
      trackedBalances: [{
        id: "b1", name: "Wallet", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD",
        // Captured at confirm time (see updateActualBalance in
        // InputPanel.tsx): $80 was exactly what was expected then.
        actualBalance: 80, actualBalanceDate: "2026-07-05T00:00:00.000Z", expectedAtCheckUSD: 80,
      }],
      transactions: [
        { id: "t1", amount: 20, currency: "USD", bucket: "WANTS", description: "Coffee before check-in", date: "2026-07-03", paymentMethod: "cash" },
        { id: "t2", amount: 15, currency: "USD", bucket: "WANTS", description: "Lunch after check-in", date: "2026-07-08", paymentMethod: "cash" },
      ],
    });
    const result = computeDashboard(data);
    const check = result.balanceChecks[0];
    // discrepancy is judged against the frozen expectedAtCheckUSD snapshot
    // ($80), not today's live running total ($65, after the July 8 lunch)
    // -- that lunch happened after the check-in and isn't the check-in's
    // fault, so it must show up only in changeSinceCheck, not discrepancy.
    expect(check.discrepancy).toBe(0);
    expect(check.changeSinceCheck).toBe(-15); // the July 8 lunch, spent after checking in
    expect(check.expected).toBe(65); // live running total: 100 - 20 - 15
  });

  it("does not depend on transaction dates at all -- a same-calendar-day transaction can't be misread as 'before' the check", () => {
    const data = makeData({
      trackedBalances: [{
        id: "b1", name: "Wallet", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD",
        actualBalance: 80, actualBalanceDate: "2026-07-05T14:23:45.123Z", expectedAtCheckUSD: 80,
      }],
      transactions: [
        { id: "t1", amount: 20, currency: "USD", bucket: "WANTS", description: "Coffee before check-in", date: "2026-07-03", paymentMethod: "cash" },
        { id: "t2", amount: 15, currency: "USD", bucket: "WANTS", description: "Bought later the same day as the check-in", date: "2026-07-05", paymentMethod: "cash" },
      ],
    });
    const result = computeDashboard(data);
    const check = result.balanceChecks[0];
    // t2 shares its calendar day with actualBalanceDate -- an earlier,
    // date-comparison-based version of this fix couldn't reliably tell
    // whether a same-day transaction came before or after the moment of
    // confirming (transactions don't carry a time of day). Judging
    // discrepancy against the captured expectedAtCheckUSD snapshot instead
    // sidesteps the question entirely: it's correct regardless of how t2's
    // date relates to actualBalanceDate.
    expect(check.discrepancy).toBe(0);
    expect(check.changeSinceCheck).toBe(-15);
    expect(check.expected).toBe(65);
  });
});

describe("net worth trend", () => {
  it("merges today's value into history, replacing any existing entry for the current month", () => {
    const data = makeData({
      income: 3000,
      netWorthHistory: [
        { ym: "2026-05", value: 1000 },
        { ym: "2026-06", value: 1200 },
        { ym: "2026-07", value: 999 }, // stale — should be replaced by today's computed value
      ],
    });
    const result = computeDashboard(data);
    const julyEntries = result.netWorthTrend.filter((h) => h.ym === "2026-07");
    expect(julyEntries).toHaveLength(1);
    expect(julyEntries[0].value).not.toBe(999);
  });

  it("keeps only the most recent 12 months", () => {
    const history = Array.from({ length: 15 }, (_, i) => ({ ym: `2025-${String(i + 1).padStart(2, "0")}`, value: i }))
      .filter((h) => Number(h.ym.split("-")[1]) <= 12);
    const data = makeData({ income: 3000, netWorthHistory: history });
    const result = computeDashboard(data);
    expect(result.netWorthTrend.length).toBeLessThanOrEqual(12);
  });

  it("is sorted ascending by year-month", () => {
    const data = makeData({
      income: 3000,
      netWorthHistory: [{ ym: "2026-03", value: 1 }, { ym: "2026-01", value: 2 }, { ym: "2026-02", value: 3 }],
    });
    const result = computeDashboard(data);
    const yms = result.netWorthTrend.map((h) => h.ym);
    expect(yms).toEqual([...yms].sort());
  });
});

describe("income history — past months judged against income at the time, not today's", () => {
  it("sixMonthTrend uses the historical income for a past month, not the current (raised) one", () => {
    const data = makeData({
      income: 3000, // "after the raise"
      incomeHistory: [{ ym: "2026-02", value: 1000 }], // income was 1000 back in February
      transactions: [{ id: "t1", amount: 50, currency: "USD", bucket: "NEEDS", description: "Groceries", date: "2026-02-10" }],
    });
    const result = computeDashboard(data);
    const feb = result.sixMonthTrend.find((t) => t.ymKey === 202602)!;
    expect(feb.income).toBe(1000);
  });

  it("current month always uses live income regardless of history", () => {
    const data = makeData({
      income: 3000,
      incomeHistory: [{ ym: "2026-02", value: 1000 }],
      transactions: [{ id: "t1", amount: 50, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-07-05" }],
    });
    const result = computeDashboard(data);
    const july = result.sixMonthTrend.find((t) => t.ymKey === 202607)!;
    expect(july.income).toBe(3000);
  });

  it("falls back to current income for months with no recorded history (legacy accounts)", () => {
    const data = makeData({
      income: 2000,
      transactions: [{ id: "t1", amount: 50, currency: "USD", bucket: "NEEDS", description: "Groceries", date: "2026-03-10" }],
    });
    const result = computeDashboard(data);
    const mar = result.sixMonthTrend.find((t) => t.ymKey === 202603)!;
    expect(mar.income).toBe(2000);
  });

  it("budgetRollover-derived debt/savings scoring is unaffected by a later raise for past months", () => {
    // A raise this month shouldn't retroactively imply January under- or over-saved
    // relative to a target it never actually had to hit.
    const data = makeData({
      income: 5000,
      incomeHistory: [{ ym: "2026-01", value: 1000 }],
      budgetRule: "50-30-20",
      transactions: [{ id: "t1", amount: 200, currency: "USD", bucket: "SAVINGS", description: "Old saving", date: "2026-01-15" }],
    });
    const result = computeDashboard(data);
    // At the OLD income (1000), 20% savings target = 200 -> exactly met, rollover ~0.
    // At the (wrong) current income (5000), 20% target = 1000 -> would show a large deficit.
    expect(result.budgetRollover.savings).toBeCloseTo(0, 0);
  });
});

describe("fresh account with $0 income — the div-by-zero guard must not leak into display", () => {
  it("reports month.income and netCashFlow as 0, not a phantom $1, and produces no NaN/Infinity", () => {
    const data = makeData({ income: 0 });
    const result = computeDashboard(data);
    expect(result.month.income).toBe(0);
    expect(result.month.netCashFlow).toBe(0);
    expect(Number.isFinite(result.month.savingsRatePct)).toBe(true);
    expect(result.budgetTargets.needs).toBe(0);
    expect(result.budgetTargets.wants).toBe(0);
    expect(result.budgetTargets.savings).toBe(0);
  });
});

describe("LBP exchange-rate history — past LBP transactions convert at the rate in effect then", () => {
  it("sixMonthTrend converts a past LBP transaction using the historical rate, not today's", () => {
    const data = makeData({
      income: 1000,
      lbpRate: 100000, // today's rate
      lbpRateHistory: [{ ym: "2026-02", value: 50000 }], // rate back in February
      transactions: [{ id: "t1", amount: 5_000_000, currency: "LBP", bucket: "NEEDS", description: "Groceries", date: "2026-02-10" }],
    });
    const result = computeDashboard(data);
    const feb = result.sixMonthTrend.find((t) => t.ymKey === 202602)!;
    // 5,000,000 LBP at the historical 50,000 rate = $100, not $50 at today's 100,000 rate.
    expect(feb.spend).toBeCloseTo(100, 5);
  });

  it("falls back to the current rate for months with no recorded rate history", () => {
    const data = makeData({
      income: 1000,
      lbpRate: 100000,
      transactions: [{ id: "t1", amount: 1_000_000, currency: "LBP", bucket: "NEEDS", description: "Groceries", date: "2026-03-10" }],
    });
    const result = computeDashboard(data);
    const mar = result.sixMonthTrend.find((t) => t.ymKey === 202603)!;
    expect(mar.spend).toBeCloseTo(10, 5);
  });
});

describe("paid-off debts don't inflate ongoing debt pressure", () => {
  it("excludes a paid-off debt's stale minPayment from the debt-pressure health score", () => {
    const withPaidOffDebt = makeData({
      income: 1000,
      debts: [
        { id: "d1", name: "Active loan", balance: 500, apr: 10, minPayment: 100, createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "d2", name: "Paid off card", balance: 0, apr: 20, minPayment: 200, createdAt: "2026-01-01T00:00:00.000Z", paidOffAt: "2026-06-01T00:00:00.000Z" },
      ],
    });
    const result = computeDashboard(withPaidOffDebt);
    const debtComponent = result.health.components.find((c) => c.key === "debt")!;
    // Only the $100 active minimum counts: debtPressurePct = 0.10 -> score = 100 - 0.10*400 = 60.
    // If the paid-off debt's $200 leaked in, pressure would be 0.30 -> score would clamp to 0.
    expect(debtComponent.score).toBe(60);
  });
});

describe("goal edge cases", () => {
  it("a goal with a $0 target shows 100% complete instead of NaN", () => {
    const data = makeData({
      goals: [{ id: "g1", name: "Untitled goal", emoji: "🎯", targetAmount: 0, currentAmount: 0, targetDate: "2026-12-01", createdAt: "2026-07-01T00:00:00.000Z" }],
    });
    const result = computeDashboard(data);
    expect(result.goals[0].projection.pctComplete).toBe(100);
    expect(Number.isNaN(result.goals[0].projection.pctComplete)).toBe(false);
  });

  it("an overdue goal shows 0 months remaining, not a phantom 1 (the div-by-zero floor leaking into display)", () => {
    const data = makeData({
      goals: [{ id: "g1", name: "Late goal", emoji: "🎯", targetAmount: 1000, currentAmount: 200, targetDate: "2026-01-01", createdAt: "2025-06-01T00:00:00.000Z" }],
    });
    const result = computeDashboard(data);
    expect(result.goals[0].projection.monthsRemaining).toBe(0);
  });
});

describe("sixMonthTrend income display — the incomeForMonth floor must not leak into the chart", () => {
  it("shows $0, not $1, for a past month with genuinely $0 income and real spend", () => {
    const data = makeData({
      income: 3000, // today's income
      incomeHistory: [{ ym: "2026-03", value: 0 }], // income was $0 back in March
      transactions: [{ id: "t1", amount: 50, currency: "USD", bucket: "NEEDS", description: "Groceries", date: "2026-03-10" }],
    });
    const result = computeDashboard(data);
    const mar = result.sixMonthTrend.find((t) => t.ymKey === 202603)!;
    expect(mar.income).toBe(0);
  });
});

describe("budget-rule history — past months judged against the rule that was actually in effect then", () => {
  it("budgetRollover uses the historical needs/wants/savings split for a past month, not today's", () => {
    const data = makeData({
      income: 1000,
      budgetRule: "80-15-5", // today's rule: high needs, low savings
      budgetRuleHistory: [{ ym: "2026-03", needs: 50, wants: 30, savings: 20 }], // rule was 50/30/20 in March
      transactions: [{ id: "t1", amount: 200, currency: "USD", bucket: "SAVINGS", description: "Old saving", date: "2026-03-15" }],
    });
    const result = computeDashboard(data);
    // At the OLD rule (50/30/20), $1000 income -> 20% savings target = $200 -> exactly met, rollover ~0.
    // At today's rule (80/15/5), 5% target = $50 -> would show a large surplus instead.
    expect(result.budgetRollover.savings).toBeCloseTo(0, 0);
  });

  it("budgetRollover counts a recurring item's spend in a past month even with no logged transaction that month", () => {
    const data = makeData({
      income: 1000,
      budgetRule: "50-30-20", // 50% needs target = $500/mo
      recurring: [{
        id: "r1", name: "Rent", emoji: "🏠", amount: 300, currency: "USD",
        frequency: "monthly", bucket: "NEEDS", startDate: "2025-01-01",
        endDate: null, totalAmount: null, createdAt: "2025-01-01T00:00:00.000Z",
      }],
      // No transactions logged at all -- rent is only ever recurring.
    });
    const result = computeDashboard(data);
    // 6 rollover-eligible past months (Jan-Jun 2026), each: $500 needs
    // target - $300 real recurring rent = $200 unspent, rolled forward.
    // Before this fix, every one of these months had zero logged
    // transactions and was skipped from rollover entirely, silently
    // dropping all $1,200 of it (and, for a month where recurring spend
    // exceeds the target, silently dropping a real deficit the same way).
    expect(result.budgetRollover.needs).toBeCloseTo(200 * 6, 5);
  });

  it("savingsStreak counts past months against the savings target that was actually in effect then, not today's higher target", () => {
    const data = makeData({
      income: 1000,
      budgetRule: "40-30-30", // today: 30% savings target
      budgetRuleHistory: [{ ym: "2026-05", needs: 50, wants: 30, savings: 20 }, { ym: "2026-06", needs: 50, wants: 30, savings: 20 }], // May & June: 20% target
      transactions: [
        { id: "t1", amount: 200, currency: "USD", bucket: "SAVINGS", description: "May saving", date: "2026-05-15" }, // exactly 20% of $1000
        { id: "t2", amount: 200, currency: "USD", bucket: "SAVINGS", description: "June saving", date: "2026-06-15" }, // exactly 20% of $1000
      ],
    });
    const result = computeDashboard(data);
    // 20% saved meets each month's historical 20% target -> 2-month streak.
    // If today's 30% target were wrongly applied, neither month would qualify.
    expect(result.streaks.some((s) => s.key === "savings-streak")).toBe(true);
  });

  it("savingsStreak is not gated on today's income being nonzero — a real historical streak survives a $0 current income", () => {
    const data = makeData({
      income: 0, // between jobs / not yet re-entered
      incomeHistory: [{ ym: "2026-06", value: 1000 }, { ym: "2026-05", value: 1000 }],
      budgetRule: "40-30-30", // 30% savings target, same in history (no override needed for this test)
      transactions: [
        { id: "t1", amount: 300, currency: "USD", bucket: "SAVINGS", description: "May saving", date: "2026-05-15" },
        { id: "t2", amount: 300, currency: "USD", bucket: "SAVINGS", description: "June saving", date: "2026-06-15" },
      ],
    });
    const result = computeDashboard(data);
    expect(result.streaks.some((s) => s.key === "savings-streak")).toBe(true);
  });
});

describe("balanceChecks — tracked balances in a non-USD currency must be compared in the same unit as spend", () => {
  it("converts an LBP tracked balance's starting/actual amounts to USD before computing expected/discrepancy", () => {
    const data = makeData({
      income: 1000,
      lbpRate: 100000, // 100,000 LBP = $1
      trackedBalances: [{
        id: "tb1", name: "Cash (LBP)", paymentMethod: "cash",
        startingBalance: 10_000_000, // 10,000,000 LBP = $100
        startingDate: "2026-07-01",
        currency: "LBP",
        actualBalance: 9_000_000, // 9,000,000 LBP = $90
        actualBalanceDate: "2026-07-10T00:00:00.000Z",
      }],
      transactions: [{ id: "t1", amount: 500000, currency: "LBP", bucket: "NEEDS", description: "Groceries", date: "2026-07-05", paymentMethod: "cash" }], // 500,000 LBP = $5
    });
    const result = computeDashboard(data);
    const check = result.balanceChecks[0];
    // expected = $100 starting - $5 spent = $95, not 10,000,000 - 5 (mixed units).
    expect(check.expected).toBeCloseTo(95, 2);
    expect(check.actual).toBeCloseTo(90, 2);
    expect(check.discrepancy).toBeCloseTo(-5, 2);
  });
});

describe("sixMonthTrend current-month recurring — evaluated as of today, matching month.totalSpend", () => {
  it("a recurring item starting mid-month is counted consistently between month.totalSpend and the trend's current-month bar", () => {
    const data = makeData({
      income: 1000,
      recurring: [{
        id: "r1", name: "New subscription", emoji: "💳", amount: 20, currency: "USD",
        frequency: "monthly", bucket: "WANTS", startDate: "2026-07-10", // starts mid-current-month
        endDate: null, totalAmount: null, createdAt: "2026-07-10T00:00:00.000Z",
      }],
    });
    const result = computeDashboard(data); // NOW is pinned to July 15 — after the 10th
    const currentMonthBar = result.sixMonthTrend.find((t) => t.ymKey === 202607)!;
    // Both should include the $20 recurring item (today, July 15, is after its July 10 start).
    expect(currentMonthBar.spend).toBeCloseTo(result.month.totalSpend, 5);
  });
});

describe("upcomingRenewals — exact calendar-day due counts, consistent regardless of local timezone", () => {
  it("computes dueInDays as a clean integer number of calendar days to the next occurrence", () => {
    const data = makeData({
      income: 1000,
      recurring: [{
        id: "r1", name: "Due in 5 days", emoji: "🔔", amount: 50, currency: "USD",
        frequency: "monthly", bucket: "NEEDS", startDate: "2026-06-20",
        endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    // NOW is pinned to July 15, 2026 — next monthly occurrence (day 20) is July 20, exactly 5 days out.
    const result = computeDashboard(data);
    const renewal = result.upcomingRenewals.find((r) => r.id === "r1");
    expect(renewal?.dueInDays).toBe(5);
  });

  it("shows a recurring item due today with dueInDays 0, even when checked partway through the day", () => {
    vi.setSystemTime(new Date(2026, 6, 15, 14, 30)); // 2:30pm local, same calendar day as NOW
    const data = makeData({
      income: 1000,
      recurring: [{
        id: "r1", name: "Due today", emoji: "🔔", amount: 15, currency: "USD",
        frequency: "monthly", bucket: "WANTS", startDate: "2026-06-15",
        endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    // Started June 15, monthly -> next occurrence is July 15, "today" under
    // NOW. Checking partway through that day (14:30, not midnight) used to
    // overshoot a full period to August 15 -- both from asOf carrying a
    // nonzero time-of-day, and separately from an off-by-one where the
    // month-stepping loop advanced past an exact boundary match instead of
    // returning it.
    const result = computeDashboard(data);
    const renewal = result.upcomingRenewals.find((r) => r.id === "r1");
    expect(renewal?.dueInDays).toBe(0);
  });

  it("a recurring item already logged this cycle (lastPaidCycle) doesn't also double-count via monthlyEquivalent, and drops off the renewals list", () => {
    const data = makeData({
      income: 3000,
      recurring: [{
        id: "r1", name: "Rent", emoji: "🏠", amount: 500, currency: "USD",
        frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01",
        endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z",
        lastPaidCycle: "2026-07", // NOW is pinned to July 15, 2026
      }],
      // The real transaction the "Log payment" action would have created.
      transactions: [{ id: "t1", amount: 500, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-07-15" }],
    });
    const result = computeDashboard(data);
    // $500 from the real transaction, NOT $1000 (which is what it'd be if
    // monthlyEquivalent's automatic estimate also counted this month).
    expect(result.month.needsSpend).toBe(500);
    expect(result.upcomingRenewals.find((r) => r.id === "r1")).toBeUndefined();
  });

  it("lastPaidCycle only suppresses its own matching month -- the next cycle still accrues and shows as upcoming", () => {
    vi.setSystemTime(new Date(2026, 7, 1)); // August 1, 2026 -- a new cycle since the July payment
    const data = makeData({
      income: 3000,
      recurring: [{
        id: "r1", name: "Rent", emoji: "🏠", amount: 500, currency: "USD",
        frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01",
        endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z",
        lastPaidCycle: "2026-07", // last month's cycle, already paid
      }],
    });
    const result = computeDashboard(data);
    // August hasn't been paid -- the automatic estimate should still count.
    expect(result.month.needsSpend).toBe(500);
    expect(result.upcomingRenewals.find((r) => r.id === "r1")).toBeDefined();
  });
});

describe("INCOME transactions — one-off receipts boost effective income without counting as spend", () => {
  it("increases month.income and netCashFlow but never appears in needsSpend/wantsSpend/savingsContrib", () => {
    const data = makeData({
      income: 1000,
      transactions: [
        { id: "t1", amount: 200, currency: "USD", bucket: "INCOME", description: "Gift from Dad", date: "2026-07-05" },
        { id: "t2", amount: 50, currency: "USD", bucket: "NEEDS", description: "Groceries", date: "2026-07-06" },
      ],
    });
    const result = computeDashboard(data);
    expect(result.month.income).toBe(1200); // 1000 salary + 200 gift
    expect(result.month.needsSpend).toBe(50); // the gift never lands here
    expect(result.month.wantsSpend).toBe(0);
    expect(result.month.savingsContrib).toBe(0); // old catch-all would have miscounted it here
    expect(result.month.totalSpend).toBe(50);
    expect(result.month.netCashFlow).toBe(1150); // 1200 - 50
  });

  it("excludes INCOME transactions from sixMonthTrend's spend line but includes them in its income line", () => {
    const data = makeData({
      income: 1000,
      transactions: [
        { id: "t1", amount: 300, currency: "USD", bucket: "INCOME", description: "Reimbursement", date: "2026-07-05" },
        { id: "t2", amount: 100, currency: "USD", bucket: "WANTS", description: "Dinner", date: "2026-07-06" },
      ],
    });
    const result = computeDashboard(data);
    const currentMonthBar = result.sixMonthTrend[5];
    expect(currentMonthBar.income).toBe(1300);
    expect(currentMonthBar.spend).toBeCloseTo(100, 5); // the reimbursement must not inflate "spend"
  });

  it("sixMonthTrend.savingsContrib reflects real savings even when spend fully allocates income (net cash flow near zero)", () => {
    const data = makeData({
      income: 1000,
      transactions: [
        { id: "t1", amount: 500, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-07-01" },
        { id: "t2", amount: 300, currency: "USD", bucket: "WANTS", description: "Fun", date: "2026-07-02" },
        { id: "t3", amount: 200, currency: "USD", bucket: "SAVINGS", description: "Brokerage", date: "2026-07-03" },
      ],
    });
    const result = computeDashboard(data);
    const currentMonthBar = result.sixMonthTrend[5];
    // Fully allocated: needs+wants+savings = income, so net cash flow (what
    // Journey's savings-rate arc used to derive a rate from) is ~0 -- but
    // $200 of real savings happened. savingsContrib must reflect that $200,
    // not the ~0 leftover, and must agree with month.savingsRatePct for the
    // same month rather than drifting from it (exactly what disagreed
    // before this fix).
    expect(currentMonthBar.savingsContrib).toBe(200);
    expect(Math.round((currentMonthBar.savingsContrib / currentMonthBar.income) * 100)).toBe(20);
    expect(Math.round(result.month.savingsRatePct)).toBe(20);
  });

  it("increases the expected balance on a tracked cash balance instead of being counted as a deduction", () => {
    const data = makeData({
      trackedBalances: [{ id: "b1", name: "Wallet", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD" }],
      transactions: [
        { id: "t1", amount: 20, currency: "USD", bucket: "WANTS", description: "Coffee", date: "2026-07-05", paymentMethod: "cash" },
        { id: "t2", amount: 30, currency: "USD", bucket: "INCOME", description: "Cash gift", date: "2026-07-06", paymentMethod: "cash" },
      ],
    });
    const result = computeDashboard(data);
    // 100 - 20 spend + 30 income = 110, not 100 - 20 - 30 = 50
    expect(result.balanceChecks[0].expected).toBe(110);
  });

  it("is excluded from budgetRollover's savings bucket for a past month (no catch-all double-count)", () => {
    const data = makeData({
      income: 1000,
      incomeHistory: [{ ym: "2026-06", value: 1000 }],
      transactions: [
        { id: "t1", amount: 500, currency: "USD", bucket: "INCOME", description: "Bonus", date: "2026-06-10" },
      ],
    });
    const result = computeDashboard(data);
    // June's effective income is boosted to 1000 + 500 = 1500 (the bonus
    // raises the real savings target too), and none of it was actually
    // logged as SAVINGS, so the full 20% target on the BOOSTED income goes
    // to rollover -- not the un-boosted 1000, and not reduced by the old
    // catch-all miscounting the bonus itself as "spend".
    expect(result.budgetRollover.savings).toBeCloseTo(1500 * 0.2, 5);
  });
});

describe("Safety net target of 0 — must never be indistinguishable from 'fully funded' at the data level", () => {
  it("targetAmount is 0 (not a phantom positive number) when needs% is 0 under a custom budget rule, even with real income and a real balance", () => {
    const data = makeData({
      income: 3000, emergencyFundBalance: 1200, emergencyFundTargetMonths: 6,
      budgetRule: "custom", budgetCustomNeeds: 0, budgetCustomWants: 30,
    });
    const result = computeDashboard(data);
    expect(result.emergencyFund.targetAmount).toBe(0);
    // remaining still floors at 0 here -- callers MUST check targetAmount > 0
    // before treating remaining <= 0 as "fully funded" (see ProjectionsScreen,
    // FinancialDashboard, InputPanel's EF hint, all fixed this session).
    expect(result.emergencyFund.remaining).toBe(0);
  });
});
