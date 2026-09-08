import { describe, it, expect } from "vitest";
import { allocateGoalCapacity, capacityByMonth, fastestGoalCompletion, type GoalCapacityInput, type RecurringCapacityInput } from "./goalFeasibility";

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

// ─────────────────────────────────────────────────────────────────────────
// fastestGoalCompletion -- the "how fast could I finish" view (2.4.68).
//
// Deliberately a SEPARATE engine from allocateGoalCapacity, not a mode of
// it. allocateGoalCapacity answers "can I afford this by that date" and
// caps every goal at requiredMonthlyRateUSD (derived from that goal's own
// targetDate) precisely so the conflict banner and the achievable /
// achievable_with_adjustment / not_achievable classification mean what they
// say. That cap is correct there and is not touched by any test below --
// the guard test at the end locks it.
//
// This engine answers the other question, and has no notion of target dates
// at all: waterfall allocation in the same priority order (soonest target
// date first), every available dollar going to the frontmost unfinished
// goal until it completes, then rolling to the next. Because capacity is
// never idle, goal i completes once the CUMULATIVE remaining through i has
// been contributed -- ceil(cumulative / capacity) -- which is what the
// per-goal assertions below encode.
describe("fastestGoalCompletion — applying surplus capacity instead of discarding it", () => {
  it("ACCEPTANCE (2.4.68): a goal needing $80/mo completes in 1 month at $5,000/mo, where the feasibility engine still says 12", () => {
    // $960 remaining against a 12-month target = $80/mo required.
    const goals: GoalCapacityInput[] = [
      { id: "g", name: "Laptop", targetAmountUSD: 960, currentAmountUSD: 0, targetDate: "2027-01-15" },
    ];

    // The gap this engine exists to close, asserted in the same test so the
    // two can never silently converge: the feasibility engine caps at the
    // required rate and reports the target date back, no matter the capacity.
    const feasibility = allocateGoalCapacity(goals, 5000, asOf);
    expect(feasibility.goals[0].requiredMonthlyRateUSD).toBeCloseTo(80, 5);
    expect(feasibility.goals[0].allocatedMonthlyRateUSD).toBeCloseTo(80, 5);
    expect(feasibility.goals[0].projectedMonths).toBe(12);

    const fastest = fastestGoalCompletion(goals, 5000, asOf);
    expect(fastest.goals[0].monthsToComplete).toBe(1);
    expect(fastest.goals[0].dateDisplay).toBe("15-02-2026");
    expect(fastest.allCompleteMonths).toBe(1);
  });

  it("no phantom acceleration: at exactly the required rate it reports the same 12 months the feasibility engine does", () => {
    const goals: GoalCapacityInput[] = [
      { id: "g", name: "Laptop", targetAmountUSD: 960, currentAmountUSD: 0, targetDate: "2027-01-15" },
    ];
    const fastest = fastestGoalCompletion(goals, 80, asOf);
    expect(fastest.goals[0].monthsToComplete).toBe(12);
    expect(fastest.goals[0].monthsToComplete).toBe(allocateGoalCapacity(goals, 80, asOf).goals[0].projectedMonths);
  });

  it("waterfall: the soonest-deadline goal takes the whole capacity and finishes first, the next starts only after it completes", () => {
    const goals: GoalCapacityInput[] = [
      { id: "later",  name: "Later",  targetAmountUSD: 1000, currentAmountUSD: 0, targetDate: "2026-11-15" },
      { id: "sooner", name: "Sooner", targetAmountUSD: 600,  currentAmountUSD: 0, targetDate: "2026-07-15" },
    ];
    const fastest = fastestGoalCompletion(goals, 500, asOf);

    // Priority order, same comparator the feasibility engine uses.
    expect(fastest.goals.map((g) => g.id)).toEqual(["sooner", "later"]);
    // Sooner: ceil(600/500) = 2. Later: funded only once Sooner is done, so
    // ceil((600+1000)/500) = 4 -- NOT ceil(1000/500) = 2, which is what
    // funding both simultaneously would have produced.
    expect(fastest.goals[0].monthsToComplete).toBe(2);
    expect(fastest.goals[1].monthsToComplete).toBe(4);
  });

  it("the all-complete date is capacity-bound and independent of ordering -- reordering the same goals cannot change it", () => {
    const a: GoalCapacityInput = { id: "a", name: "A", targetAmountUSD: 600,  currentAmountUSD: 0, targetDate: "2026-07-15" };
    const b: GoalCapacityInput = { id: "b", name: "B", targetAmountUSD: 1000, currentAmountUSD: 0, targetDate: "2026-11-15" };

    const forward = fastestGoalCompletion([a, b], 500, asOf);
    const reversed = fastestGoalCompletion([b, a], 500, asOf);

    // ceil(totalRemaining / capacity) = ceil(1600/500) = 4, both ways: no
    // capacity is ever idle, so the order only moves the intermediate
    // per-goal dates, never the point at which everything is done.
    expect(forward.allCompleteMonths).toBe(4);
    expect(reversed.allCompleteMonths).toBe(4);
    expect(forward.allCompleteMonths).toBe(Math.ceil(1600 / 500));
  });

  it("zero capacity: no finite completion exists, matching projectCompletion's own null convention", () => {
    const goals: GoalCapacityInput[] = [
      { id: "g", name: "Stalled", targetAmountUSD: 600, currentAmountUSD: 0, targetDate: "2026-07-15" },
    ];
    const fastest = fastestGoalCompletion(goals, 0, asOf);
    expect(fastest.goals[0].monthsToComplete).toBeNull();
    expect(fastest.goals[0].dateDisplay).toBeNull();
    expect(fastest.allCompleteMonths).toBeNull();
  });

  it("an already-met goal completes at 0 months and consumes no capacity, so it never delays the goals behind it", () => {
    const goals: GoalCapacityInput[] = [
      { id: "done", name: "Done",   targetAmountUSD: 500,  currentAmountUSD: 500, targetDate: "2026-03-15" },
      { id: "open", name: "Open",   targetAmountUSD: 1000, currentAmountUSD: 0,   targetDate: "2026-11-15" },
    ];
    const fastest = fastestGoalCompletion(goals, 500, asOf);
    expect(fastest.goals[0].monthsToComplete).toBe(0);
    // ceil(1000/500) = 2 -- the met goal contributed nothing to the
    // cumulative total, so "open" is not pushed out behind it.
    expect(fastest.goals[1].monthsToComplete).toBe(2);
    expect(fastest.allCompleteMonths).toBe(2);
  });

  it("GUARD: allocateGoalCapacity's output is byte-identical for the existing conflict fixture -- this engine changes nothing about feasibility", () => {
    // The exact fixture from the conflict test at the top of this file.
    const goals: GoalCapacityInput[] = [
      { id: "a", name: "Soonest",  targetAmountUSD: 600,  currentAmountUSD: 0, targetDate: "2026-07-15" },
      { id: "b", name: "Middle",   targetAmountUSD: 1000, currentAmountUSD: 0, targetDate: "2026-11-15" },
      { id: "c", name: "Furthest", targetAmountUSD: 1500, currentAmountUSD: 0, targetDate: "2027-04-15" },
    ];
    // Captured from the engine as it stands before fastestGoalCompletion
    // existed, and asserted in full -- every field of every goal, not a
    // spot-check, so any drift in the feasibility path fails here.
    expect(allocateGoalCapacity(goals, 250, asOf)).toEqual({
      conflict: {
        hasConflict: true,
        totalRequiredMonthlyRateUSD: 300,
        totalCapacityUSD: 250,
        shortfallUSD: 50,
      },
      goals: [
        { id: "a", name: "Soonest",  status: "achievable",                 remainingUSD: 600,  requiredMonthlyRateUSD: 100, allocatedMonthlyRateUSD: 100, projectedMonths: 6,  projectedDateDisplay: "15-07-2026", shortfallMonthlyRateUSD: 0 },
        { id: "b", name: "Middle",   status: "achievable",                 remainingUSD: 1000, requiredMonthlyRateUSD: 100, allocatedMonthlyRateUSD: 100, projectedMonths: 10, projectedDateDisplay: "15-11-2026", shortfallMonthlyRateUSD: 0 },
        { id: "c", name: "Furthest", status: "achievable_with_adjustment", remainingUSD: 1500, requiredMonthlyRateUSD: 100, allocatedMonthlyRateUSD: 50,  projectedMonths: 30, projectedDateDisplay: "15-07-2028", shortfallMonthlyRateUSD: 50 },
      ],
    });
  });

  it("capacity below total required: the fastest view stays coherent and does not contradict the conflict the feasibility engine reports", () => {
    const goals: GoalCapacityInput[] = [
      { id: "a", name: "Soonest",  targetAmountUSD: 600,  currentAmountUSD: 0, targetDate: "2026-07-15" },
      { id: "b", name: "Middle",   targetAmountUSD: 1000, currentAmountUSD: 0, targetDate: "2026-11-15" },
      { id: "c", name: "Furthest", targetAmountUSD: 1500, currentAmountUSD: 0, targetDate: "2027-04-15" },
    ];
    // Same inputs the guard above proves still report hasConflict: true.
    expect(allocateGoalCapacity(goals, 250, asOf).conflict.hasConflict).toBe(true);

    const fastest = fastestGoalCompletion(goals, 250, asOf);
    // Every goal still finishes eventually -- "can't hit the stated dates"
    // and "will never finish" are different claims, and only the first is
    // true here. Cumulative: 600 -> 3mo, 1600 -> 7mo, 3100 -> 13mo.
    expect(fastest.goals.map((g) => g.monthsToComplete)).toEqual([3, 7, 13]);
    expect(fastest.allCompleteMonths).toBe(Math.ceil(3100 / 250));
  });
});
