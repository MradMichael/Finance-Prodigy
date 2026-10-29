// TIME-04 (owner, session 30, DECISIONS_PENDING entry 9 (a)): a statement's
// day ends at local (Beirut) midnight, as a close's does and as every other
// date in the app. reanchorTrackedBalance read a bare statement date as the
// end of that day in UTC (T23:59:59.999Z), which is 02:59 the next morning
// in Beirut: a purchase dated the statement day and entered after midnight
// landed on the wrong side of the baseline. CI runs this under UTC,
// Asia/Beirut and America/Los_Angeles; the Beirut-only example says so.
import { describe, it, expect } from "vitest";
import { reanchorTrackedBalance, isAfterBalanceBaseline, DEFAULT_LBP_RATE, type TrackedBalance, type StoredTransaction } from "./localData";
import { cycleCloseInstant, asCycleKey } from "./period";

const TB = (): TrackedBalance => ({ id: "tb", name: "Card", paymentMethod: "card", cardId: "c1", startingBalance: 500, startingDate: "2026-08-01", currency: "USD" });
/** The last millisecond of a local calendar day, as an ISO instant. */
const localDayEnd = (y: number, m: number, d: number) => new Date(new Date(y, m - 1, d + 1).getTime() - 1).toISOString();
const IN_BEIRUT = Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Beirut";

describe("TIME-04: a statement's day ends at local midnight", () => {
  it("a statement dated 5 September: its baseline is the last moment of 5 September, local time", () => {
    const r = reanchorTrackedBalance(TB(), 430, 461, DEFAULT_LBP_RATE, "2026-09-05");
    expect(r.startingAt).toBe(localDayEnd(2026, 9, 5));
    expect(r.startingDate).toBe("2026-09-05");
    expect(r.actualBalanceDate).toBe("2026-09-05"); // unchanged: it takes the statement date as given
  });

  it("the same instant a close uses for the end of that day (a cycle ending 5 September)", () => {
    const r = reanchorTrackedBalance(TB(), 430, 461, DEFAULT_LBP_RATE, "2026-09-05");
    expect(r.startingAt).toBe(cycleCloseInstant(asCycleKey("2026-08"), 6)); // payday the 6th: 6 Aug - 5 Sep
  });

  it.runIf(IN_BEIRUT)("the write-up's example, in Beirut: baseline 2026-09-05T20:59:59.999Z; a purchase dated 5 September entered at 01:00 on 6 September counts after it", () => {
    const r = reanchorTrackedBalance(TB(), 430, 461, DEFAULT_LBP_RATE, "2026-09-05");
    expect(r.startingAt).toBe("2026-09-05T20:59:59.999Z");
    const late = { id: "t", amount: 12, currency: "USD", bucket: "WANTS", description: "Bakery", date: "2026-09-05", createdAt: "2026-09-05T22:00:00.000Z" } as StoredTransaction;
    expect(isAfterBalanceBaseline(late, r)).toBe(true);
  });

  it("a full instant is still taken as given", () => {
    const r = reanchorTrackedBalance(TB(), 430, 461, DEFAULT_LBP_RATE, "2026-09-05T10:15:00.000Z");
    expect(r.startingAt).toBe("2026-09-05T10:15:00.000Z");
  });
});
