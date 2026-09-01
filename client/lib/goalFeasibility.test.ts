import { describe, it, expect } from "vitest";
import { allocateGoalCapacity, type GoalCapacityInput } from "./goalFeasibility";

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
