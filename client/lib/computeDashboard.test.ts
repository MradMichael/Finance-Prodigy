import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeDashboard, computeHoldingsByCurrency } from "./computeDashboard";
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

  it("custom rule with needs+wants > 100 is clamped by floorCustomSplit so savings can no longer go negative", () => {
    // Needs (70) stays put; Wants (50) gets squeezed down to whatever leaves
    // Savings at least MIN_SPLIT_PCT=5 -- 100-70-25=5 -- instead of the old
    // unfloored "100-70-50=-20%" that used to produce a negative target.
    const data = makeData({ income: 1000, budgetRule: "custom", budgetCustomNeeds: 70, budgetCustomWants: 50 });
    const result = computeDashboard(data);
    expect(result.budgetTargetPct).toEqual({ needs: 70, wants: 25, savings: 5 });
    expect(result.budgetTargets.needs).toBeCloseTo(700, 5);
    expect(result.budgetTargets.wants).toBeCloseTo(250, 5);
    expect(result.budgetTargets.savings).toBeCloseTo(50, 5);
    expect(result.effectiveBudgetTargets.savings).toBeGreaterThanOrEqual(0);
  });

  it("a custom rule's Needs/Wants can never reach 0% even from raw stored data below the floor (e.g. saved before the floor existed, or on a device that hasn't opened Budget since)", () => {
    const data = makeData({ income: 1000, budgetRule: "custom", budgetCustomNeeds: 0, budgetCustomWants: 100 });
    const result = computeDashboard(data);
    expect(result.budgetTargetPct.needs).toBe(5);
    expect(result.budgetTargetPct.needs).toBeGreaterThan(0);
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
      debts: debtBalance > 0 ? [{ id: "d1", name: "Loan", balance: debtBalance, apr: 10, minPayment: 100, currency: "USD", createdAt: NOW.toISOString() }] : [],
    });
    const result = computeDashboard(data);
    expect(result.netWorth.tier).toBe(expectedTier);
    expect(result.netWorth.tierColor).toBe(expectedColor);
  });
});

describe("net worth: goal currency conversion (regression guard)", () => {
  // Was toUSD(g.currentAmount, undefined) -- a no-op that silently treated
  // every goal as USD regardless of its own currency field. Harmless while
  // every goal really was USD; a real bug the moment any goal is LBP.
  it("an LBP goal's currentAmount converts correctly into net worth assets, not treated as a bare USD number", () => {
    const lbpGoal = { id: "g1", name: "LBP savings", emoji: "🎯", targetAmount: 89_500_000, currentAmount: 8_950_000, currency: "LBP" as const, targetDate: "2027-01-01", createdAt: NOW.toISOString() };
    const data = makeData({ income: 1000, lbpRate: 89500, goals: [lbpGoal] });
    const result = computeDashboard(data);
    // 8,950,000 LBP / 89,500 = $100 -- if the bug were still present, this
    // would instead compute as if $8,950,000 were held in USD.
    expect(result.netWorth.assets).toBe(100);
    expect(result.netWorth.total).toBe(100);
  });
});

describe("computeHoldingsByCurrency (CurrencyScreen's exposure figure)", () => {
  it("includes an LBP goal's currentAmount in lbpAssets, converted correctly into holdingsTotalUSD", () => {
    const lbpGoal = { id: "g1", name: "LBP savings", emoji: "🎯", targetAmount: 89_500_000, currentAmount: 8_950_000, currency: "LBP" as const, targetDate: "2027-01-01", createdAt: NOW.toISOString() };
    const data = makeData({ goals: [lbpGoal] });
    const { usdAssets, lbpAssets, holdingsTotalUSD } = computeHoldingsByCurrency(data, 89500);
    expect(lbpAssets).toBe(8_950_000);
    expect(usdAssets).toBe(0);
    // 8,950,000 / 89,500 = $100.
    expect(holdingsTotalUSD).toBe(100);
  });

  it("a USD goal's currentAmount lands in usdAssets, not lbpAssets", () => {
    const usdGoal = { id: "g1", name: "USD savings", emoji: "🎯", targetAmount: 1000, currentAmount: 250, currency: "USD" as const, targetDate: "2027-01-01", createdAt: NOW.toISOString() };
    const data = makeData({ goals: [usdGoal] });
    const { usdAssets, lbpAssets, holdingsTotalUSD } = computeHoldingsByCurrency(data, 89500);
    expect(usdAssets).toBe(250);
    expect(lbpAssets).toBe(0);
    expect(holdingsTotalUSD).toBe(250);
  });

  it("debts are never counted, regardless of currency -- a liability isn't exposure the way an asset is", () => {
    const lbpDebt = { id: "d1", name: "LBP loan", balance: 8_950_000, apr: 5, minPayment: 100000, currency: "LBP" as const, createdAt: NOW.toISOString() };
    const data = makeData({ debts: [lbpDebt] });
    const { usdAssets, lbpAssets, holdingsTotalUSD } = computeHoldingsByCurrency(data, 89500);
    expect(usdAssets).toBe(0);
    expect(lbpAssets).toBe(0);
    expect(holdingsTotalUSD).toBe(0);
  });

  it("sums goals alongside assets and tracked balances in the same currency bucket", () => {
    const lbpGoal = { id: "g1", name: "LBP goal", emoji: "🎯", targetAmount: 1_000_000, currentAmount: 500_000, currency: "LBP" as const, targetDate: "2027-01-01", createdAt: NOW.toISOString() };
    const data = makeData({
      goals: [lbpGoal],
      assets: [{ id: "a1", name: "Cash stash", value: 200_000, currency: "LBP" as const, createdAt: NOW.toISOString() }],
      trackedBalances: [{ id: "b1", name: "Wallet", paymentMethod: "cash", startingBalance: 100_000, startingDate: "2026-07-01", currency: "LBP" as const }],
    });
    const { lbpAssets } = computeHoldingsByCurrency(data, 89500);
    expect(lbpAssets).toBe(500_000 + 200_000 + 100_000);
  });
});

// CRITICAL, written before the implementation per Standing Rule 4. Caught
// during Phase 1.4 plan review: the goals[] projection block computes one
// "req" (required-monthly-pace) value and uses it for two things that need
// OPPOSITE currency treatment -- requiredMonthly must stay in the goal's
// own native currency (GoalsScreen seeds its "quick amount" contribution
// buttons directly from this number; converting it to USD would make an
// LBP goal's quick-add button suggest a USD-scale amount that then gets
// added UNconverted to an LBP currentAmount, under-contributing by
// roughly the LBP rate). paceRatio/onTrack, by contrast, MUST be
// USD-converted, since they're compared against savingsContrib (a USD
// aggregate). Also guards the pre-existing goalScores/goals[].projection
// drift risk the code's own comment already flags (line ~224-226) --
// currency conversion sharpens that risk, since it's easy to convert one
// independently-computed block and miss the other.
describe("goal pace: native-currency requiredMonthly vs USD-converted paceRatio", () => {
  it("an LBP goal's requiredMonthly stays LBP-scale; paceRatio correctly reflects the USD-converted comparison against savingsContrib", () => {
    const lbpGoal = {
      id: "g1", name: "LBP goal", emoji: "🎯",
      targetAmount: 89_500_000, currentAmount: 0, currency: "LBP" as const,
      targetDate: "2026-08-15", // 31 days after NOW -> ms rounds to 1
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const data = makeData({
      income: 3000,
      lbpRate: 89500,
      goals: [lbpGoal],
      transactions: [
        { id: "t1", amount: 500, currency: "USD", bucket: "SAVINGS", description: "Savings", date: "2026-07-01" },
      ],
    });
    const result = computeDashboard(data);
    const g = result.goals[0];

    // req = 89,500,000 / 1 month = 89,500,000 LBP/month, native -- NOT
    // divided down to a USD-scale ~1000. If this were wrongly converted,
    // requiredMonthly would read ~1000, not ~89,500,000.
    expect(g.projection.requiredMonthly).toBeCloseTo(89_500_000, -3);

    // reqUSD = 89,500,000 / 89,500 = $1000/month. savingsContrib = $500.
    // Correctly converted: pace = 500/1000 = 0.5. If unconverted (raw req
    // treated as if USD), pace would be ~500/89,500,000 ≈ 0.0000056 -> 0.00.
    expect(g.projection.paceRatio).toBeCloseTo(0.5, 1);
    expect(g.projection.onTrack).toBe(false); // 0.5 < the 0.9 threshold

    // The health-score component (goalScores, computed independently) must
    // agree with the projection above, not drift -- same underlying pace.
    const goalsComponent = result.health.components.find((c) => c.key === "goals")!;
    // avgGoalPace over one goal at pace 0.5 -> goalScore = round(0.5 * 100) = 50.
    expect(goalsComponent.score).toBe(50);
  });

  it("a USD goal (unchanged behavior): requiredMonthly and paceRatio both already effectively 'USD', no regression", () => {
    const usdGoal = {
      id: "g1", name: "USD goal", emoji: "🎯",
      targetAmount: 1000, currentAmount: 0, currency: "USD" as const,
      targetDate: "2026-08-15",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const data = makeData({
      income: 3000,
      goals: [usdGoal],
      transactions: [
        { id: "t1", amount: 500, currency: "USD", bucket: "SAVINGS", description: "Savings", date: "2026-07-01" },
      ],
    });
    const result = computeDashboard(data);
    const g = result.goals[0];
    expect(g.projection.requiredMonthly).toBeCloseTo(1000, -1);
    expect(g.projection.paceRatio).toBeCloseTo(0.5, 1);
    const goalsComponent = result.health.components.find((c) => c.key === "goals")!;
    expect(goalsComponent.score).toBe(50);
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
      debts: [{ id: "d1", name: "Huge APR loan", balance: 10000, apr: 99, minPayment: 1, currency: "USD", createdAt: NOW.toISOString() }],
    });
    const result = computeDashboard(data);
    expect(result.debt.plan?.feasible).toBe(false);
    expect(result.debt.plan?.warning).toBeTruthy();
  });

  it("feasible plan produces a comparison where avalanche never has more total interest than snowball on the same inputs", () => {
    const data = makeData({
      income: 5000,
      debts: [
        { id: "d1", name: "Card A", balance: 2000, apr: 24, minPayment: 50, currency: "USD", createdAt: NOW.toISOString() },
        { id: "d2", name: "Card B", balance: 500, apr: 8, minPayment: 20, currency: "USD", createdAt: NOW.toISOString() },
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
        confirmCutoverDate: "2026-07-01", // grandfathers the June 20 cycle so only the upcoming July one is in play
      }],
    });
    const result = computeDashboard(data);
    // Monthly from June 20 -> next occurrence July 20, 5 days after "now" (July 15).
    expect(result.upcomingRenewals).toHaveLength(1);
    expect(result.upcomingRenewals[0].dueInDays).toBe(5);
    expect(result.upcomingRenewals[0].overdueCount).toBe(0);
  });

  it("excludes a recurring item due more than 7 days out", () => {
    const data = makeData({
      recurring: [{
        id: "r1", name: "Annual plan", emoji: "📅", amount: 100, currency: "USD", frequency: "yearly",
        bucket: "WANTS", startDate: "2026-09-01", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z", // starts in the future relative to NOW (July 15) -- not yet due, not overdue
      }],
    });
    const result = computeDashboard(data);
    expect(result.upcomingRenewals).toHaveLength(0);
  });

  it("an item with a cycle due BEFORE now that was never confirmed shows OVERDUE, not silently skipped to the next occurrence", () => {
    // No confirmCutoverDate -- a fresh item, every cycle needs confirmation
    // from day one. Its June 1 cycle was never confirmed, and it's now well
    // past due (NOW is July 15) -- this is the core behavior change 2.5.3
    // exists to ship: unconfirmed history doesn't just quietly roll forward
    // to "next occurrence" the way the old live-estimate model did.
    const data = makeData({
      recurring: [{
        id: "r1", name: "Rent", emoji: "🏠", amount: 500, currency: "USD", frequency: "monthly",
        bucket: "NEEDS", startDate: "2026-06-01", endDate: null, totalAmount: null, createdAt: "2026-06-01T00:00:00.000Z",
      }],
    });
    const result = computeDashboard(data);
    // Both June 1 and July 1 have occurred by July 15 (NOW) -- 2 overdue, oldest first.
    expect(result.upcomingRenewals).toHaveLength(1);
    expect(result.upcomingRenewals[0].overdueCount).toBe(2);
    expect(result.upcomingRenewals[0].dueDate).toBe("2026-06-01");
  });

  it("an overdue item is included regardless of how far the window would otherwise exclude it -- overdue never ages out of visibility", () => {
    const data = makeData({
      recurring: [{
        id: "r1", name: "Old bill", emoji: "🧾", amount: 100, currency: "USD", frequency: "monthly",
        bucket: "NEEDS", startDate: "2026-01-01", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    const result = computeDashboard(data);
    // Jan-Jul: 7 monthly cycles have occurred by July 15, none confirmed.
    const renewal = result.upcomingRenewals.find((r) => r.id === "r1");
    expect(renewal).toBeDefined();
    expect(renewal!.overdueCount).toBe(7);
    expect(renewal!.dueDate).toBe("2026-01-01"); // FIFO -- oldest first
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
        { id: "d1", name: "Active loan", balance: 500, apr: 10, minPayment: 100, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "d2", name: "Paid off card", balance: 0, apr: 20, minPayment: 200, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", paidOffAt: "2026-06-01T00:00:00.000Z" },
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
      goals: [{ id: "g1", name: "Untitled goal", emoji: "🎯", targetAmount: 0, currentAmount: 0, currency: "USD", targetDate: "2026-12-01", createdAt: "2026-07-01T00:00:00.000Z" }],
    });
    const result = computeDashboard(data);
    expect(result.goals[0].projection.pctComplete).toBe(100);
    expect(Number.isNaN(result.goals[0].projection.pctComplete)).toBe(false);
  });

  it("an overdue goal shows 0 months remaining, not a phantom 1 (the div-by-zero floor leaking into display)", () => {
    const data = makeData({
      goals: [{ id: "g1", name: "Late goal", emoji: "🎯", targetAmount: 1000, currentAmount: 200, currency: "USD", targetDate: "2026-01-01", createdAt: "2025-06-01T00:00:00.000Z" }],
    });
    const result = computeDashboard(data);
    expect(result.goals[0].projection.monthsRemaining).toBe(0);
  });

  it("a paused goal is excluded from the goal-pace score but stays listed (flagged) for history", () => {
    const met      = { id: "g1", name: "Met",     emoji: "🎯", targetAmount: 1000,   currentAmount: 1000, currency: "USD" as const, targetDate: "2026-08-01", createdAt: "2026-01-01T00:00:00.000Z" };
    const farBehind = { id: "g2", name: "Behind", emoji: "🎯", targetAmount: 100000, currentAmount: 0,    currency: "USD" as const, targetDate: "2026-08-01", createdAt: "2026-01-01T00:00:00.000Z" };

    // Both active: a fully-met goal (score 1) averaged with a badly-behind
    // one with zero savingsContrib to fund it (score 0) -> goalScore 50.
    const bothActive = computeDashboard(makeData({ goals: [met, farBehind] }));
    const goalsCompBothActive = bothActive.health.components.find((c) => c.key === "goals")!;
    expect(goalsCompBothActive.score).toBe(50);
    expect(goalsCompBothActive.detail).toContain("2 active goal");

    // Pausing the dragging-it-down goal removes it from the average entirely
    // (not just floors its contribution), so the score should jump to what
    // the met goal alone would score, and the detail should count 1, not 2.
    const onePaused = computeDashboard(makeData({ goals: [met, { ...farBehind, pausedAt: "2026-07-01T00:00:00.000Z" }] }));
    const goalsCompOnePaused = onePaused.health.components.find((c) => c.key === "goals")!;
    expect(goalsCompOnePaused.score).toBe(100);
    expect(goalsCompOnePaused.detail).toContain("1 active goal");

    // Still present in the goals list (not deleted), just flagged, so the UI
    // can keep showing it with a "Paused" badge instead of losing history.
    expect(onePaused.goals).toHaveLength(2);
    expect(onePaused.goals.find((g) => g.name === "Behind")?.paused).toBe(true);
    expect(onePaused.goals.find((g) => g.name === "Met")?.paused).toBe(false);
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

  it("budgetRollover counts a GRANDFATHERED recurring item's spend in a past month even with no logged transaction that month", () => {
    const data = makeData({
      income: 1000,
      budgetRule: "50-30-20", // 50% needs target = $500/mo
      recurring: [{
        id: "r1", name: "Rent", emoji: "🏠", amount: 300, currency: "USD",
        frequency: "monthly", bucket: "NEEDS", startDate: "2025-01-01",
        endDate: null, totalAmount: null, createdAt: "2025-01-01T00:00:00.000Z",
        confirmCutoverDate: "2026-07-01", // every rollover-eligible past month (Jan-Jun 2026) is before this -- grandfathered, old accrual preserved
      }],
      // No transactions logged at all -- rent is only ever recurring.
    });
    const result = computeDashboard(data);
    // 6 rollover-eligible past months (Jan-Jun 2026), each: $500 needs
    // target - $300 real recurring rent = $200 unspent, rolled forward.
    // This is exactly the historized-value promise: a grandfathered item's
    // past-month accrual is unchanged from what the old live-estimate model
    // already showed -- 2.5.3 doesn't retroactively rewrite it.
    expect(result.budgetRollover.needs).toBeCloseTo(200 * 6, 5);
  });

  it("budgetRollover does NOT count a NON-grandfathered recurring item's spend in a past month unless it was actually confirmed -- the model's whole point", () => {
    const data = makeData({
      income: 1000,
      budgetRule: "50-30-20",
      recurring: [{
        id: "r1", name: "Rent", emoji: "🏠", amount: 300, currency: "USD",
        frequency: "monthly", bucket: "NEEDS", startDate: "2025-01-01",
        endDate: null, totalAmount: null, createdAt: "2025-01-01T00:00:00.000Z",
        // No confirmCutoverDate -- a fresh, v3-native item. Every month needs its own confirmation.
      }],
    });
    const result = computeDashboard(data);
    // No confirmations logged anywhere -- none of the 6 past months should
    // roll over any recurring contribution at all (0, not $1,200).
    expect(result.budgetRollover.needs).toBeCloseTo(0, 5);
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
  it("a GRANDFATHERED recurring item starting mid-month is counted consistently between month.totalSpend and the trend's current-month bar", () => {
    const data = makeData({
      income: 1000,
      recurring: [{
        id: "r1", name: "New subscription", emoji: "💳", amount: 20, currency: "USD",
        frequency: "monthly", bucket: "WANTS", startDate: "2026-07-10", // starts mid-current-month
        endDate: null, totalAmount: null, createdAt: "2026-07-10T00:00:00.000Z",
        confirmCutoverDate: "2026-08-01", // cutover after this month -- July is still grandfathered, old accrual applies
      }],
    });
    const result = computeDashboard(data); // NOW is pinned to July 15 — after the 10th
    const currentMonthBar = result.sixMonthTrend.find((t) => t.ymKey === 202607)!;
    // Both sites now route through the SAME historizedRecurringContribution
    // call -- structurally incapable of disagreeing, not just tested to
    // currently agree. Both should include the $20 recurring item (today,
    // July 15, is after its July 10 start, and July is still pre-cutover).
    expect(currentMonthBar.spend).toBeCloseTo(result.month.totalSpend, 5);
    expect(currentMonthBar.spend).toBeCloseTo(20, 5);
  });

  it("a NON-grandfathered recurring item contributes 0 to both sites until confirmed -- totals go down, not up, on ship day", () => {
    const data = makeData({
      income: 1000,
      recurring: [{
        id: "r1", name: "New subscription", emoji: "💳", amount: 20, currency: "USD",
        frequency: "monthly", bucket: "WANTS", startDate: "2026-07-10",
        endDate: null, totalAmount: null, createdAt: "2026-07-10T00:00:00.000Z",
        // No confirmCutoverDate -- needs confirmation from day one.
      }],
    });
    const result = computeDashboard(data);
    const currentMonthBar = result.sixMonthTrend.find((t) => t.ymKey === 202607)!;
    expect(currentMonthBar.spend).toBe(0);
    expect(result.month.totalSpend).toBe(0);
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
        confirmCutoverDate: "2026-07-01", // grandfathers the June cycle
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
        confirmCutoverDate: "2026-07-01", // grandfathers the June cycle
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

  it("a recurring item CONFIRMED this cycle via a real transaction doesn't also double-count via historizedRecurringContribution, and drops off the renewals list", () => {
    const data = makeData({
      income: 3000,
      recurring: [{
        id: "r1", name: "Rent", emoji: "🏠", amount: 500, currency: "USD",
        frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01",
        endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z",
        confirmCutoverDate: "2026-07-01", // Jan-Jun grandfathered; July's cycle needs confirmation
      }],
      // The real transaction confirming July's cycle would have created.
      transactions: [{ id: "t1", amount: 500, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-07-01", recurringId: "r1" }],
    });
    const result = computeDashboard(data);
    // $500 from the real transaction, NOT $1000 -- historizedRecurringContribution
    // returns 0 for July (on/after cutover) regardless of confirmation status,
    // so double-counting is structurally impossible now, not just avoided.
    expect(result.month.needsSpend).toBe(500);
    // Confirmed -- not overdue, and the next occurrence (Aug 1) is more than
    // 7 days out from July 15 -- correctly absent from the renewals list.
    expect(result.upcomingRenewals.find((r) => r.id === "r1")).toBeUndefined();
  });

  it("confirming one cycle doesn't suppress the NEXT cycle -- it still surfaces once due, at $0 spend until it's confirmed too", () => {
    vi.setSystemTime(new Date(2026, 7, 1)); // August 1, 2026 -- a new cycle since the July confirmation
    const data = makeData({
      income: 3000,
      recurring: [{
        id: "r1", name: "Rent", emoji: "🏠", amount: 500, currency: "USD",
        frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01",
        endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z",
        confirmCutoverDate: "2026-07-01",
      }],
      transactions: [{ id: "t1", amount: 500, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-07-01", recurringId: "r1" }],
    });
    const result = computeDashboard(data);
    // August hasn't been confirmed -- correctly $0, not a phantom $500
    // estimate (the exact "totals go down until confirmed" promise), but it
    // still shows up as due today so there's something to act on.
    expect(result.month.needsSpend).toBe(0);
    const renewal = result.upcomingRenewals.find((r) => r.id === "r1");
    expect(renewal).toBeDefined();
    expect(renewal!.dueInDays).toBe(0);
    expect(renewal!.overdueCount).toBe(0); // due today, not yet overdue
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
  it("a 0%-Needs custom budget rule can no longer collapse the EF target to 0 (Needs is floored at MIN_SPLIT_PCT) -- real income + real months always produces a real target", () => {
    const data = makeData({
      income: 3000, emergencyFundBalance: 1200, emergencyFundTargetMonths: 6,
      budgetRule: "custom", budgetCustomNeeds: 0, budgetCustomWants: 30,
    });
    const result = computeDashboard(data);
    expect(result.emergencyFund.targetAmount).toBeGreaterThan(0);
  });

  it("targetAmount is 0 (not a phantom positive number) when the months-of-coverage target is 0, even with real income and a real balance", () => {
    const data = makeData({
      income: 3000, emergencyFundBalance: 1200, emergencyFundTargetMonths: 0,
      budgetRule: "50-30-20",
    });
    const result = computeDashboard(data);
    expect(result.emergencyFund.targetAmount).toBe(0);
    // remaining still floors at 0 here -- callers MUST check targetAmount > 0
    // before treating remaining <= 0 as "fully funded" (see ProjectionsScreen,
    // FinancialDashboard, InputPanel's EF hint, all fixed this session).
    expect(result.emergencyFund.remaining).toBe(0);
  });
});

describe("alerts", () => {
  it("is empty when nothing needs attention", () => {
    const data = makeData({ income: 3000, emergencyFundBalance: 100000, emergencyFundTargetMonths: 1 });
    const result = computeDashboard(data);
    expect(result.alerts).toEqual([]);
  });

  it("flags an underfunded safety net, with severity escalating below 25%", () => {
    const data = makeData({ income: 3000, emergencyFundTargetMonths: 6, emergencyFundBalance: 500 });
    const result = computeDashboard(data);
    const efAlert = result.alerts.find((a) => a.id === "ef-underfunded");
    expect(efAlert).toBeTruthy();
    expect(efAlert!.severity).toBe("critical"); // $500 against a real multi-thousand-dollar target is well under 25%
    expect(efAlert!.screen).toBe("setup");
  });

  it("flags an infeasible debt plan using debtEngine's own warning text", () => {
    // income left at 0 (default) so netCashFlow/extra are both 0 and, with
    // minPayment also 0, monthlyPayment is exactly 0 -- deterministically
    // hits computeDashboard's "monthly income is fully consumed" branch
    // rather than depending on exactly how much of a positive cash flow
    // gets auto-allocated toward debt.
    const data = makeData({
      debts: [{ id: "d1", name: "Card", balance: 5000, apr: 29, minPayment: 0, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    const result = computeDashboard(data);
    const debtAlert = result.alerts.find((a) => a.id === "debt-infeasible");
    expect(debtAlert).toBeTruthy();
    expect(debtAlert!.severity).toBe("critical");
    expect(debtAlert!.screen).toBe("debts");
  });

  it("flags a recurring item due within 3 days as a warning, and due today as critical", () => {
    // NOW is July 15, 2026. A monthly item anchored on the 17th is due in 2
    // days; one anchored on the 15th is due today.
    const data = makeData({
      recurring: [
        { id: "r1", name: "Netflix", emoji: "🎬", amount: 15, currency: "USD", frequency: "monthly", bucket: "WANTS", startDate: "2026-06-17", endDate: null, totalAmount: null, createdAt: "2026-06-17T00:00:00.000Z", confirmCutoverDate: "2026-07-01" },
        { id: "r2", name: "Rent", emoji: "🏠", amount: 800, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-06-15", endDate: null, totalAmount: null, createdAt: "2026-06-15T00:00:00.000Z", confirmCutoverDate: "2026-07-01" },
      ],
    });
    const result = computeDashboard(data);
    const netflixAlert = result.alerts.find((a) => a.id === "renewal-r1");
    const rentAlert = result.alerts.find((a) => a.id === "renewal-r2");
    expect(netflixAlert).toEqual({ id: "renewal-r1", severity: "warning", message: "Netflix is due in 2 days", screen: "overview" });
    expect(rentAlert).toEqual({ id: "renewal-r2", severity: "critical", message: "Rent is due today", screen: "overview" });
  });

  it("flags an overdue recurring item as critical, stating the count", () => {
    const data = makeData({
      recurring: [{
        id: "r1", name: "Uni", emoji: "🎓", amount: 750, currency: "USD", frequency: "monthly",
        bucket: "NEEDS", startDate: "2026-04-01", endDate: null, totalAmount: null, createdAt: "2026-04-01T00:00:00.000Z",
        // No confirmCutoverDate -- Apr/May/Jun/Jul cycles all unconfirmed by July 15.
      }],
    });
    const result = computeDashboard(data);
    const alert = result.alerts.find((a) => a.id === "renewal-r1");
    expect(alert).toEqual({ id: "renewal-r1", severity: "critical", message: "Uni is 4 payments overdue", screen: "overview" });
  });

  it("uses the singular form for exactly one overdue payment", () => {
    const data = makeData({
      recurring: [{
        id: "r1", name: "Gym", emoji: "💪", amount: 30, currency: "USD", frequency: "monthly",
        bucket: "WANTS", startDate: "2026-07-01", endDate: null, totalAmount: null, createdAt: "2026-07-01T00:00:00.000Z",
      }],
    });
    const result = computeDashboard(data);
    const alert = result.alerts.find((a) => a.id === "renewal-r1");
    expect(alert).toEqual({ id: "renewal-r1", severity: "critical", message: "Gym is overdue", screen: "overview" });
  });

  it("flags a tracked balance that doesn't match what was logged, but not a small/rounding-level difference", () => {
    const bigMismatch = makeData({
      trackedBalances: [{ id: "b1", name: "Wallet", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD", actualBalance: 50, actualBalanceDate: "2026-07-15" }],
    });
    expect(computeDashboard(bigMismatch).alerts.find((a) => a.id === "balance-b1")).toBeTruthy();

    const smallMismatch = makeData({
      trackedBalances: [{ id: "b1", name: "Wallet", paymentMethod: "cash", startingBalance: 100, startingDate: "2026-07-01", currency: "USD", actualBalance: 98, actualBalanceDate: "2026-07-15" }],
    });
    expect(computeDashboard(smallMismatch).alerts.find((a) => a.id === "balance-b1")).toBeUndefined();
  });

  it("sorts critical alerts before warnings", () => {
    const data = makeData({
      income: 3000, emergencyFundTargetMonths: 6, emergencyFundBalance: 500, // critical (EF)
      recurring: [{ id: "r1", name: "Gym", emoji: "💪", amount: 30, currency: "USD", frequency: "monthly", bucket: "WANTS", startDate: "2026-06-17", endDate: null, totalAmount: null, createdAt: "2026-06-17T00:00:00.000Z", confirmCutoverDate: "2026-07-01" }], // warning (due in 2 days), grandfathered so it isn't overdue instead
    });
    const result = computeDashboard(data);
    const severities = result.alerts.map((a) => a.severity);
    const firstWarningIdx = severities.indexOf("warning");
    const lastCriticalIdx = severities.lastIndexOf("critical");
    if (firstWarningIdx !== -1 && lastCriticalIdx !== -1) {
      expect(lastCriticalIdx).toBeLessThan(firstWarningIdx);
    }
  });
});
