import { describe, it, expect } from "vitest";
import { projectCompletion } from "./projections";

describe("projectCompletion", () => {
  it("reads as 0 months, today, when the gap is already closed", () => {
    const asOf = new Date(2026, 6, 15); // July 15, 2026
    const result = projectCompletion(0, 500, asOf);
    expect(result.months).toBe(0);
    expect(result.dateDisplay).toBe("15-07-2026");
  });

  it("treats a negative remaining the same as already met", () => {
    const asOf = new Date(2026, 6, 15);
    const result = projectCompletion(-50, 500, asOf);
    expect(result.months).toBe(0);
    expect(result.dateDisplay).toBe("15-07-2026");
  });

  it("returns null when there's still a gap but no positive monthly rate", () => {
    expect(projectCompletion(1000, 0)).toEqual({ months: null, dateDisplay: null });
    expect(projectCompletion(1000, -50)).toEqual({ months: null, dateDisplay: null });
  });

  it("rounds up to the next whole month and lands on the matching calendar date", () => {
    const asOf = new Date(2026, 0, 31); // Jan 31, 2026
    // 1000 / 400 = 2.5 months -> rounds up to 3
    const result = projectCompletion(1000, 400, asOf);
    expect(result.months).toBe(3);
    // Jan 31 + 3 months clamps to Apr 30 (April has 30 days) rather than overflowing to May.
    expect(result.dateDisplay).toBe("30-04-2026");
  });

  it("a larger monthly rate reaches the same target sooner", () => {
    const asOf = new Date(2026, 6, 15);
    const slow = projectCompletion(2000, 200, asOf);
    const fast = projectCompletion(2000, 500, asOf);
    expect(fast.months).toBeLessThan(slow.months!);
  });
});
