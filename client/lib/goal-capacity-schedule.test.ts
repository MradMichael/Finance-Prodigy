// Approved in session 34 (owner, session 33, P3-B: "keep -- freed money goes to goals by default, changeable"): the goals
// allocation with a monthly capacity that steps up when an obligation ends. The closed form's rule applied
// month by month, so a flat schedule gives allocateGoalCapacity's answer exactly.
import { describe, it, expect } from "vitest";
import { allocateGoalCapacity, allocateGoalCapacityScheduled, type GoalCapacityInput } from "./goalFeasibility";

const asOf = new Date(2028, 0, 1);
const goals: GoalCapacityInput[] = [
  { id: "a", name: "Soonest", targetAmountUSD: 1200, currentAmountUSD: 0, targetDate: "2029-01-01" },
  { id: "b", name: "Middle", targetAmountUSD: 4000, currentAmountUSD: 1000, targetDate: "2030-01-01" },
  { id: "c", name: "Furthest", targetAmountUSD: 9000, currentAmountUSD: 0, targetDate: "2031-01-01" },
];

describe("a stepped capacity for goals", () => {
  it("a flat schedule matches the closed form, goal for goal", () => {
    expect(allocateGoalCapacityScheduled(goals, () => 250, asOf)).toEqual(allocateGoalCapacity(goals, 250, asOf));
  });

  it("a step during the stage brings the later goals forward", () => {
    const flat = allocateGoalCapacity(goals, 150, asOf);
    const stepped = allocateGoalCapacityScheduled(goals, (m) => (m >= 6 ? 150 + 750 : 150), asOf);
    const months = (r: typeof flat, id: string) => r.goals.find((g) => g.id === id)!.projectedMonths;
    expect(months(stepped, "c")!).toBeLessThan(months(flat, "c") ?? Infinity);
    expect(months(stepped, "a")).toBe(months(flat, "a")); // already fully funded at its own pace
  });

  it("a goal no step ever funds stays unreachable", () => {
    const r = allocateGoalCapacityScheduled([{ id: "z", name: "Z", targetAmountUSD: 100, currentAmountUSD: 0, targetDate: "2029-01-01" }], () => 0, asOf);
    expect(r.goals[0].projectedMonths).toBeNull();
  });
});
