// HELD (owner, session 33: "fix; draft any wording and hold that item"). Projections' combined goal figure
// summed each goal's required rate, and a goal whose target passes before the goals stage starts counted
// its whole remainder as one month's need ($5,469/mo on the review's account). Such goals leave the sum
// and are reported apart, for their own drafted line.
import { describe, it, expect } from "vitest";
import { allocateGoalCapacity, type GoalCapacityInput } from "./goalFeasibility";

const STAGE_START = new Date(2027, 11, 1);
const goal = (id: string, over: Partial<GoalCapacityInput>): GoalCapacityInput => ({ id, name: id, targetAmountUSD: 1000, currentAmountUSD: 0, targetDate: "2028-12-01", ...over });

describe("the combined goal figure", () => {
  it("leaves out a goal whose target passes before the stage starts, and names it apart", () => {
    const laptop = goal("Laptop", { currentAmountUSD: 530, targetDate: "2027-03-01" });
    const car = goal("New car", { targetAmountUSD: 8000, currentAmountUSD: 3000, targetDate: "2028-06-01" });
    const r = allocateGoalCapacity([laptop, car], 660, STAGE_START);
    const carRate = r.goals.find((g) => g.id === "New car")!.requiredMonthlyRateUSD;
    expect(r.conflict.totalRequiredMonthlyRateUSD).toBeCloseTo(carRate, 6);
    expect(r.conflict.passedTargets).toEqual([{ id: "Laptop", name: "Laptop" }]);
  });

  it("a goal still reachable counts as before, and nothing is listed apart", () => {
    const r = allocateGoalCapacity([goal("Car", {})], 660, STAGE_START);
    expect(r.conflict.totalRequiredMonthlyRateUSD).toBeCloseTo(r.goals[0].requiredMonthlyRateUSD, 6);
    expect(r.conflict.passedTargets).toEqual([]);
  });

  it("the boundary: a target the day before the stage starts has passed, the day after hasn't", () => {
    const before = goal("Before", { targetDate: "2027-11-30" });
    const after = goal("After", { targetDate: "2027-12-02" });
    const r = allocateGoalCapacity([before, after], 100000, STAGE_START);
    expect(r.conflict.passedTargets.map((g) => g.id)).toEqual(["Before"]);
    // The same goals T4's status calls passed: with ample capacity, only the passed one isn't on schedule.
    expect(r.goals.find((g) => g.id === "Before")!.status).not.toBe("achievable");
    expect(r.goals.find((g) => g.id === "After")!.status).toBe("achievable");
  });

  it("a complete goal past its date isn't listed (nothing left to meet)", () => {
    const r = allocateGoalCapacity([goal("Phone", { currentAmountUSD: 1000, targetDate: "2026-06-01" })], 660, STAGE_START);
    expect(r.conflict.passedTargets).toEqual([]);
  });
});
