import { describe, it, expect } from "vitest";
import { allocateGoalCapacity, capacityByMonth, type GoalCapacityInput, type RecurringCapacityInput } from "./goalFeasibility";

const asOf = new Date(2026, 0, 15); // Jan 15, 2026

// F3 (Goal Feasibility Engine) sub-phase 1 -- pure allocation engine, tests
// first, unwired. Written before the implementation, per the design: the
// conflict case is written first because it's the one that makes this
// feature honest (docs/ROADMAP.md, Phase 4).
describe("allocateGoalCapacity — the conflict case (written first, per design)", () => {
  it("three goals each individually affordable alone, but their sum exceeds capacity: hasConflict is true, and NOT all three read achievable", () => {
    // Each goal alone needs $100/mo -- well under the $250/mo capacity if
    // checked in isolation, which is exactly the trap: checked together,
    // they need $300/mo against $250/mo available.
    const goals: GoalCapacityInput[] = [
      { id: "a", name: "Soonest",  targetAmountUSD: 600,  currentAmountUSD: 0, targetDate: "2026-07-15" },  // 6 months out
      { id: "b", name: "Middle",   targetAmountUSD: 1000, currentAmountUSD: 0, targetDate: "2026-11-15" }, // 10 months out
      { id: "c", name: "Furthest", targetAmountUSD: 1500, currentAmountUSD: 0, targetDate: "2027-04-15" }, // 15 months out
    ];
    const report = allocateGoalCapacity(goals, 250, asOf);

    // The conflict flag is computed from the sum of each goal's own
    // required rate against total capacity -- independently of how the
    // per-goal walk below turns out, not inferred from it.
    expect(report.conflict.hasConflict).toBe(true);
    expect(report.conflict.totalRequiredMonthlyRateUSD).toBeCloseTo(300, 5);
    expect(report.conflict.totalCapacityUSD).toBe(250);
    expect(report.conflict.shortfallUSD).toBeCloseTo(50, 5);

    // This is the actual regression lock: if a future change reverts to
    // checking each goal against total capacity independently (exactly
    // what 2.4.44 already proved is wrong), every goal here would read
    // "achievable" (each needs only $100 against $250 available) and this
    // assertion would fail.
    const allAchievable = report.goals.every((g) => g.status === "achievable");
    expect(allAchievable).toBe(false);
  });
});

describe("allocateGoalCapacity — per-goal classification", () => {
  it("a single goal within capacity reads achievable", () => {
    const goals: GoalCapacityInput[] = [
      { id: "a", name: "Trip", targetAmountUSD: 600, currentAmountUSD: 0, targetDate: "2026-07-15" }, // 6 months, needs $100/mo
    ];
    const report = allocateGoalCapacity(goals, 150, asOf);
    expect(report.conflict.hasConflict).toBe(false);
    expect(report.goals[0].status).toBe("achievable");
    expect(report.goals[0].allocatedMonthlyRateUSD).toBeCloseTo(100, 5);
    expect(report.goals[0].shortfallMonthlyRateUSD).toBe(0);
  });

  it("a goal needing more than the ENTIRE capacity, alone, is not_achievable -- no reprioritization could fix it", () => {
    const goals: GoalCapacityInput[] = [
      { id: "a", name: "Big goal", targetAmountUSD: 6000, currentAmountUSD: 0, targetDate: "2026-07-15" }, // 6 months, needs $1000/mo
    ];
    const report = allocateGoalCapacity(goals, 200, asOf); // capacity itself is only $200
    expect(report.goals[0].status).toBe("not_achievable");
    expect(report.goals[0].requiredMonthlyRateUSD).toBeCloseTo(1000, 5);
    // Still gets whatever capacity exists -- progress happens, it's just
    // not enough to hit the stated date, and never could be at this
    // capacity regardless of priority order.
    expect(report.goals[0].allocatedMonthlyRateUSD).toBeCloseTo(200, 5);
    expect(report.goals[0].projectedMonths).not.toBeNull();
  });

  it("priority order (soonest target date first) determines which goal absorbs a shortfall -- the later goal, not the earlier one", () => {
    const goals: GoalCapacityInput[] = [
      { id: "later",  name: "Later goal",  targetAmountUSD: 1000, currentAmountUSD: 0, targetDate: "2026-11-15" }, // 10 months, needs $100/mo
      { id: "sooner", name: "Sooner goal", targetAmountUSD: 600,  currentAmountUSD: 0, targetDate: "2026-07-15" }, // 6 months, needs $100/mo
    ];
    // Capacity covers one goal's full need plus half the other's.
    const report = allocateGoalCapacity(goals, 150, asOf);

    const sooner = report.goals.find((g) => g.id === "sooner")!;
    const later = report.goals.find((g) => g.id === "later")!;
    expect(sooner.status).toBe("achievable");
    expect(sooner.allocatedMonthlyRateUSD).toBeCloseTo(100, 5);
    expect(later.status).toBe("achievable_with_adjustment");
    expect(later.allocatedMonthlyRateUSD).toBeCloseTo(50, 5);
    expect(later.shortfallMonthlyRateUSD).toBeCloseTo(50, 5);

    // Priority order in the report itself is soonest-first.
    expect(report.goals.map((g) => g.id)).toEqual(["sooner", "later"]);
  });

  it("an already-met goal (currentAmount >= targetAmount) reads achievable trivially and doesn't consume capacity from others", () => {
    const goals: GoalCapacityInput[] = [
      { id: "met",    name: "Already met", targetAmountUSD: 500, currentAmountUSD: 500, targetDate: "2026-07-15" },
      { id: "active", name: "Still going", targetAmountUSD: 600, currentAmountUSD: 0,   targetDate: "2026-11-15" },
    ];
    const report = allocateGoalCapacity(goals, 100, asOf);
    const met = report.goals.find((g) => g.id === "met")!;
    const active = report.goals.find((g) => g.id === "active")!;
    expect(met.status).toBe("achievable");
    expect(met.allocatedMonthlyRateUSD).toBe(0);
    // The still-active goal gets the full capacity -- the met goal took none of it.
    expect(active.allocatedMonthlyRateUSD).toBeCloseTo(60, 5);
  });

  it("no goals: no conflict, empty report", () => {
    const report = allocateGoalCapacity([], 500, asOf);
    expect(report.conflict.hasConflict).toBe(false);
    expect(report.goals).toEqual([]);
  });
});

// F3 sub-phase 2 -- capacity input, including the step-change. Path B
// (owner's decision, docs/ROADMAP.md): computed internally from
// StoredRecurring.endDate directly, rather than waiting on Phase 3's full
// product surface. The acceptance criterion this exists to satisfy
// (ROADMAP's own Phase 3 text): "the forward view correctly shows capacity
// increasing at termination" -- written first, below.
describe("capacityByMonth — the step-change (the acceptance criterion, written first)", () => {
  // A UTC-midnight asOf, not the local-midnight `new Date(2026,0,15)` used
  // above -- endDate strings parse as UTC midnight (this codebase's own
  // established convention, e.g. goalPace's targetDate handling), and this
  // suite's exact-date `<=` comparisons are far more sensitive to a
  // local/UTC mismatch than the rounded-month-count comparisons above.
  const asOf = new Date("2026-01-15");

  it("capacity increases at the exact month an obligation with an endDate terminates, and stays elevated after", () => {
    // A $200/mo obligation ending exactly 3 months from asOf.
    const obligations: RecurringCapacityInput[] = [
      { id: "loan", monthlyAmountUSD: 200, endDate: "2026-04-15" }, // 3 months from Jan 15
    ];
    const months = capacityByMonth(500, obligations, 6, asOf);

    // Before termination: base capacity only.
    expect(months[0].capacityUSD).toBe(500); // this month (Jan)
    expect(months[2].capacityUSD).toBe(500); // Mar -- still active
    // At and after termination: the freed $200/mo is added.
    expect(months[3].capacityUSD).toBe(700); // Apr -- terminates this month
    expect(months[4].capacityUSD).toBe(700); // May -- stays elevated
    expect(months[6].capacityUSD).toBe(700); // Jul -- still elevated
  });

  it("an obligation with no end date (endDate: null) never frees up capacity", () => {
    const obligations: RecurringCapacityInput[] = [{ id: "rent", monthlyAmountUSD: 300, endDate: null }];
    const months = capacityByMonth(400, obligations, 12, asOf);
    expect(months.every((m) => m.capacityUSD === 400)).toBe(true);
  });

  it("multiple obligations terminating in different months each contribute their own step", () => {
    const obligations: RecurringCapacityInput[] = [
      { id: "a", monthlyAmountUSD: 100, endDate: "2026-03-15" }, // 2 months out
      { id: "b", monthlyAmountUSD: 50,  endDate: "2026-06-15" }, // 5 months out
    ];
    const months = capacityByMonth(300, obligations, 6, asOf);
    expect(months[1].capacityUSD).toBe(300); // Feb -- neither terminated yet
    expect(months[2].capacityUSD).toBe(400); // Mar -- "a" terminates (+100)
    expect(months[4].capacityUSD).toBe(400); // May -- still just "a"
    expect(months[5].capacityUSD).toBe(450); // Jun -- "b" terminates too (+50)
  });

  it("an obligation that already ended before asOf is already freed from month 0", () => {
    const obligations: RecurringCapacityInput[] = [{ id: "old", monthlyAmountUSD: 150, endDate: "2025-12-01" }];
    const months = capacityByMonth(500, obligations, 2, asOf);
    expect(months[0].capacityUSD).toBe(650);
  });

  it("returns monthsAhead + 1 entries (this month plus each month ahead), indexed by monthsFromNow", () => {
    const months = capacityByMonth(500, [], 6, asOf);
    expect(months).toHaveLength(7);
    expect(months.map((m) => m.monthsFromNow)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
