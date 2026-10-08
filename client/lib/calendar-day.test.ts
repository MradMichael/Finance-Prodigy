// The recurring engine takes calendar days, not instants (session 4 item 7;
// FIX_PLANS.md, "nextOccurrence takes a calendar day"). Before, every caller
// built "today" as the UTC midnight of its local day, and nextOccurrence read
// that instant back by its LOCAL day -- yesterday, west of UTC. The overdue
// check and the walks compared instants against the same value and got the
// right day, so the lag showed only where nextOccurrence's own "next on or
// after" decided: a grandfathered cycle due yesterday was offered as a
// renewal in Los Angeles (measured), and in no zone east of it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring } from "./localData";
import { asCalendarDay, storedDay, calendarDayOf, addDays, dayStart, occurrenceDay } from "./calendarDay";

afterEach(() => { vi.useRealTimers(); });

const rent = (o: Partial<StoredRecurring>): StoredRecurring => ({
  id: "r1", name: "Rent", emoji: "R", amount: 100, currency: "USD", frequency: "monthly", bucket: "NEEDS",
  startDate: "2026-09-01", endDate: null, totalAmount: null, createdAt: "2026-08-01T00:00:00.000Z", ...o,
});

describe("the renewals list reads today as today, in every zone", () => {
  it("a grandfathered cycle due yesterday is not offered on the cutover day", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 1, 10, 0), toFake: ["Date"] }); // 1 Oct, local morning
    // Monthly from 30 Aug: 30 Aug, 30 Sep, 30 Oct. Cycles before the 1 Oct cutover are grandfathered.
    const d = { ...DEFAULT_DATA, income: 3000, recurring: [rent({ startDate: "2026-08-30", confirmCutoverDate: "2026-10-01" })] } as LocalFinancials;
    expect(computeDashboard(d).upcomingRenewals).toEqual([]); // the next real cycle, 30 Oct, is outside the 7-day window
  });

  it("an item due today is due today, at 00:30 and at 23:30 local, and overdue the next morning", () => {
    const d = { ...DEFAULT_DATA, income: 3000, recurring: [rent({})], transactions: [{ id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-09-01", recurringId: "r1" }] } as LocalFinancials;
    for (const [h, m] of [[0, 30], [23, 30]]) {
      vi.useFakeTimers({ now: new Date(2026, 9, 1, h, m), toFake: ["Date"] });
      expect(computeDashboard(d).upcomingRenewals.map((x) => [x.dueDate, x.dueInDays, x.overdueCount])).toEqual([["2026-10-01", 0, 0]]);
    }
    vi.useFakeTimers({ now: new Date(2026, 9, 2, 0, 30), toFake: ["Date"] });
    expect(computeDashboard(d).upcomingRenewals.map((x) => [x.dueDate, x.dueInDays, x.overdueCount])).toEqual([["2026-10-01", -1, 1]]);
  });
});

describe("calendar days", () => {
  it("are the LOCAL day of an instant", () => {
    const late = new Date(2026, 8, 30, 23, 30);
    expect(calendarDayOf(late)).toBe(`2026-09-30`);
    expect(calendarDayOf(new Date(2026, 9, 1, 0, 30))).toBe("2026-10-01");
  });

  it("step by calendar days, across month and year ends, in plain UTC arithmetic", () => {
    expect(addDays(asCalendarDay("2026-09-30"), 1)).toBe("2026-10-01");
    expect(addDays(asCalendarDay("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(asCalendarDay("2028-02-28"), 1)).toBe("2028-02-29");
    expect(addDays(asCalendarDay("2026-03-29"), -1)).toBe("2026-03-28"); // Beirut's spring-forward night: no hour lost
  });

  it("start at the UTC midnight occurrences are built on, and read back from them", () => {
    expect(dayStart(asCalendarDay("2026-10-01")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(occurrenceDay(new Date("2026-10-01T00:00:00.000Z"))).toBe("2026-10-01");
  });

  it("refuse anything that isn't a calendar day", () => {
    expect(() => asCalendarDay("2026-10-1")).toThrow();
    expect(() => asCalendarDay("2026-10-01T00:00:00.000Z")).toThrow();
  });

  it("read a stored date without throwing: its day, or the value unchanged", () => {
    expect(storedDay("2026-10-01")).toBe("2026-10-01");
    expect(storedDay("2026-10-01T05:00:00.000Z")).toBe("2026-10-01"); // an instant keeps its UTC day, as new Date() read it
    expect(storedDay("1/10/2026")).toBe("1/10/2026");
  });
});
