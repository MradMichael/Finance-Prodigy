// TIME-05 (blind-spot audit): Lebanon's daylight-saving nights and its winter
// offset had no tests. The code reads as DST-safe, but nothing showed it, and
// two comments called Beirut a fixed UTC+3 (it's UTC+2 from late October to
// late March).
//
// The zone's facts (bundled ICU data, measured for the audit):
//   * 28 -> 29 March 2026: 23:59 GMT+2 is followed by 01:00 GMT+3; local
//     midnight on 29 March doesn't exist (2026-03-28T22:00Z).
//   * 24 October 2026: at 24:00 GMT+3 the clock goes back to 23:00 GMT+2, so
//     23:00-23:59 on the 24th happens twice (the change is 2026-10-24T21:00Z).
//
// These are coverage tests: they pass on today's code and pin it. They run
// only in Asia/Beirut (the CI leg), where the instants are Beirut's; the
// "runs here" test below makes the Beirut leg fail if they ever stop running.
import { describe, it, expect } from "vitest";
import { currentCycleKey, cycleCloseInstant, cycleProgress, asCycleKey } from "./period";
import { todayISO, isoLocalDay, nextOccurrence, type StoredRecurring } from "./localData";

const BEIRUT = Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Beirut";

describe("Beirut's clock changes and winter offset", () => {
  it.runIf(process.env.TZ === "Asia/Beirut")("runs in Beirut on the Beirut leg (fails closed if the zone isn't honoured)", () => {
    expect(BEIRUT).toBe(true);
  });

  describe.runIf(BEIRUT)("on Beirut's clock", () => {
    it("premise: winter is UTC+2, summer UTC+3", () => {
      expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(-120);
      expect(new Date(2026, 6, 15, 12).getTimezoneOffset()).toBe(-180);
    });

    it("cycle keys either side of both changes, payday the 1st and the 27th", () => {
      const cases: [Date, number, string][] = [
        [new Date(2026, 2, 28, 23, 30), 1, "2026-03"],
        [new Date(2026, 2, 29, 1, 30), 1, "2026-03"],
        [new Date(2026, 9, 24, 23, 30), 1, "2026-10"],
        [new Date(2026, 9, 25, 1, 30), 1, "2026-10"],
        [new Date(2026, 2, 28, 23, 30), 27, "2026-03"], // 27 Mar - 26 Apr
        [new Date(2026, 9, 24, 23, 30), 27, "2026-09"], // 27 Sep - 26 Oct
        [new Date(2026, 9, 25, 1, 30), 27, "2026-09"],
      ];
      for (const [now, startDay, key] of cases) expect(currentCycleKey(now, startDay)).toBe(key);
    });

    it("a cycle spanning a 23-hour and a 25-hour day still counts whole days", () => {
      // 27 Mar - 26 Apr 2026 holds the spring change; 27 Sep - 26 Oct the autumn one.
      expect(cycleProgress(new Date(2026, 3, 1, 12), 27)).toEqual({ daysInto: 6, daysInCycle: 31 });
      expect(cycleProgress(new Date(2026, 9, 26, 12), 27)).toEqual({ daysInto: 30, daysInCycle: 30 });
    });

    it("a cycle ending the night the clock skips midnight closes at the last real instant of its day", () => {
      // Payday the 29th: the "2026-02" cycle ends 28 March; 29 March's midnight doesn't exist.
      expect(cycleCloseInstant(asCycleKey("2026-02"), 29)).toBe("2026-03-28T21:59:59.999Z"); // 23:59:59.999 GMT+2
    });

    it("a cycle ending the night the clock goes back closes after the repeated hour", () => {
      // Payday the 25th: the "2026-09" cycle ends 24 October; its last instant is 23:59:59.999 GMT+2.
      expect(cycleCloseInstant(asCycleKey("2026-09"), 25)).toBe("2026-10-24T21:59:59.999Z");
    });

    it("today's date through both changes", () => {
      expect(isoLocalDay(new Date("2026-10-24T20:30:00.000Z"))).toBe("2026-10-24"); // 23:30, first pass (GMT+3)
      expect(isoLocalDay(new Date("2026-10-24T21:30:00.000Z"))).toBe("2026-10-24"); // 23:30 again (GMT+2)
      expect(isoLocalDay(new Date("2026-10-24T22:30:00.000Z"))).toBe("2026-10-25"); // 00:30 GMT+2
      expect(isoLocalDay(new Date("2026-03-28T22:30:00.000Z"))).toBe("2026-03-29"); // 01:30 GMT+3; midnight skipped
      expect(todayISO()).toBe(isoLocalDay(new Date()));
    });

    it("a winter instant late in the UTC day is already tomorrow locally", () => {
      // 15 Dec 2026, 22:30Z is 16 Dec 00:30 in Beirut (UTC+2): the winter case
      // the summer-only local-day test couldn't show.
      expect(isoLocalDay(new Date("2026-12-15T22:30:00.000Z"))).toBe("2026-12-16");
    });

    it("a monthly bill due on the 29th falls due on 29 March, the night the clock skips midnight", () => {
      const rent: StoredRecurring = {
        id: "r-rent", name: "Rent", emoji: "🏠", amount: 450, currency: "USD", frequency: "monthly", bucket: "NEEDS",
        startDate: "2026-01-29", endDate: null, totalAmount: null, createdAt: "2026-01-20T09:00:00.000Z",
      };
      const next = nextOccurrence(rent, new Date(2026, 2, 20, 12));
      expect(next?.toISOString().slice(0, 10)).toBe("2026-03-29");
    });
  });
});
