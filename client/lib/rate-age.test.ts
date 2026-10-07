// COPY-08 (blind-spot audit): "days since the rate was updated" floored
// elapsed 24-hour periods, so an edit 20 calendar days ago, made at 09:00
// and read at 08:00, showed "19 days". The 14-day staleness warning fired a
// calendar day late for the same reason. Both now count LOCAL calendar days
// (rounded across 23- and 25-hour days), which is what "N days" means to a
// reader.
import { describe, it, expect, vi, afterEach } from "vitest";
import { calendarDaysSince, DEFAULT_DATA, LBP_RATE_STALE_DAYS, type LocalFinancials } from "./localData";
import { computeDashboard } from "./computeDashboard";

afterEach(() => { vi.useRealTimers(); });
const at = (d: Date) => vi.useFakeTimers({ now: d, toFake: ["Date"] });

describe("calendarDaysSince", () => {
  it("counts calendar days, not elapsed 24-hour periods", () => {
    // 17 Sep 09:00 local to 7 Oct 08:00 local: 19 days 23 hours, 20 calendar days.
    expect(calendarDaysSince(new Date(2026, 8, 17, 9).toISOString(), new Date(2026, 9, 7, 8))).toBe(20);
    expect(calendarDaysSince(new Date(2026, 9, 6, 23, 50).toISOString(), new Date(2026, 9, 7, 0, 10))).toBe(1);
    expect(calendarDaysSince(new Date(2026, 9, 7, 0, 10).toISOString(), new Date(2026, 9, 7, 23, 50))).toBe(0);
  });

  it("across a 25-hour day (Beirut's 24 October) still counts whole days", () => {
    expect(calendarDaysSince(new Date(2026, 9, 20, 12).toISOString(), new Date(2026, 9, 27, 12))).toBe(7);
  });

  // The spring change is the one flooring gets wrong: the week holds a
  // 23-hour day, so its midnights are 6 days 23 hours apart in Beirut.
  it("across a 23-hour day (Beirut's 29 March) still counts whole days", () => {
    expect(calendarDaysSince(new Date(2026, 2, 25, 12).toISOString(), new Date(2026, 3, 1, 12))).toBe(7);
  });
});

describe("the rate-staleness alert", () => {
  const data = (updated: Date) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, lbpRateUpdatedAt: updated.toISOString() }) as LocalFinancials;

  it("names the calendar days: 20, not 19", () => {
    at(new Date(2026, 9, 7, 8));
    const alert = computeDashboard(data(new Date(2026, 8, 17, 9))).alerts.find((a) => a.id === "rate-stale");
    expect(alert?.message).toBe("LBP rate hasn't been updated in 20 days");
  });

  it(`fires on the ${LBP_RATE_STALE_DAYS}th calendar day, even an hour short of ${LBP_RATE_STALE_DAYS} full days`, () => {
    at(new Date(2026, 9, 7, 8));
    const updated = new Date(2026, 9, 7 - LBP_RATE_STALE_DAYS, 9);
    expect(computeDashboard(data(updated)).alerts.some((a) => a.id === "rate-stale")).toBe(true);
  });
});
