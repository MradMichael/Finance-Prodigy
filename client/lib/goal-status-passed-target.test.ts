// T4 (session 32 review): Projections said "On track" for a goal it lands a year after its target. The
// goals stage starts after the safety net and debt; a target that passes during that wait was floored to
// "1 month away" (monthsUntil), so a goal that fits in one month read as on schedule. On schedule now
// needs the target to be on or after the stage's start; such a goal falls to the existing rule's other
// two statuses.
import { describe, it, expect } from "vitest";
import { allocateGoalCapacity, type GoalCapacityInput } from "./goalFeasibility";

const STAGE_START = new Date(2027, 11, 1); // the goals stage begins 1 Dec 2027
const goal = (over: Partial<GoalCapacityInput>): GoalCapacityInput => ({ id: "g1", name: "Laptop", targetAmountUSD: 1000, currentAmountUSD: 530, targetDate: "2027-03-01", ...over });

describe("a goal whose target passes before its funding starts", () => {
  it("isn't on track; its own need fits the monthly amount, so it needs adjustment", () => {
    const [g] = allocateGoalCapacity([goal({})], 660, STAGE_START).goals;
    expect(g.status).not.toBe("achievable");
    expect(g.status).toBe("achievable_with_adjustment");
  });

  it("is not achievable at this amount when its own need exceeds the whole monthly amount (as before)", () => {
    const [g] = allocateGoalCapacity([goal({ currentAmountUSD: 0, targetAmountUSD: 5000 })], 660, STAGE_START).goals;
    expect(g.status).toBe("not_achievable");
  });

  it("a complete goal is on track whatever its date (unchanged)", () => {
    const [g] = allocateGoalCapacity([goal({ currentAmountUSD: 1000 })], 660, STAGE_START).goals;
    expect(g.status).toBe("achievable");
  });

  it("a goal whose target is after the stage starts is judged as before (unchanged)", () => {
    const [g] = allocateGoalCapacity([goal({ targetDate: "2028-12-01" })], 660, STAGE_START).goals;
    expect(g.status).toBe("achievable");
  });
});
