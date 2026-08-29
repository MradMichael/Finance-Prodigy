// AUD-03 (external audit, 2026-08-28) needs process.env.TZ set to a
// negative-UTC-offset zone to reproduce at all -- V8/Node resolves and
// caches the process's timezone internally, and does NOT reliably re-read
// process.env.TZ after that first resolution, confirmed directly:
//   process.env.TZ = "America/New_York"; new Date(...); // Eastern
//   delete process.env.TZ; new Date(...);                // STILL Eastern
// Set at module load, before any Date is constructed anywhere (including
// by vitest's own internals) or vi.useFakeTimers() is called, so the
// engine's cache never observes anything but this value. Kept in its own
// file (isolated worker, Vitest's default per-file isolation) specifically
// so this doesn't leak into every other date-dependent test in the suite
// the way it did the first time this was tried inside computeDashboard.test.ts.
process.env.TZ = "America/New_York"; // UTC-5 (winter) / UTC-4 (summer)

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return { ...DEFAULT_DATA, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 15)); // July 15, 2026
});
afterEach(() => {
  vi.useRealTimers();
});

describe("goal target date display, negative-UTC-offset user (AUD-03)", () => {
  it("shows the goal's real target date, not one day early", () => {
    const data = makeData({
      goals: [{ id: "g1", name: "Trip", emoji: "🎯", targetAmount: 1000, currentAmount: 0, currency: "USD", targetDate: "2026-12-25", createdAt: "2026-07-01T00:00:00.000Z" }],
    });
    const result = computeDashboard(data);
    expect(result.goals[0].projection.targetDateDisplay).toBe("25-12-2026");
  });
});
