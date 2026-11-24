// Session 62, item 1 (owner; TODO 117): when "Add to Recurring" makes an item from a bill already logged by hand,
// the item starts one month after the latest such payment (the same day, clamped to the month's end), so the period
// already paid is never asked for. The payment on screen (the entry form's or the edit sheet's) counts as one.
import { describe, it, expect } from "vitest";
import { quickRecurringStart, type StoredTransaction } from "./localData";

let n = 0;
const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: `t${n++}`, amount: 9.99, currency: "USD", bucket: "WANTS", description: "Netflix", date: "2026-10-01", paymentMethod: "card", createdAt: "2026-10-01T09:00:00.000Z", ...o }) as StoredTransaction;
const TODAY = "2026-11-24";

describe("quickRecurringStart", () => {
  it("one month after the latest payment: the rows with that name, or the payment on screen, whichever is later", () => {
    const rows = [tx({ date: "2026-09-20" }), tx({ description: "  netflix ", date: "2026-10-22" }), tx({ description: "Spotify", date: "2026-11-20" })];
    expect(quickRecurringStart("Netflix", rows, "2026-11-05", TODAY)).toBe("2026-12-05");
    expect(quickRecurringStart("Netflix", rows, "2026-10-01", TODAY)).toBe("2026-11-22");
    expect(quickRecurringStart("NETFLIX ", rows, undefined, TODAY)).toBe("2026-11-22");
  });
  it("deleted and purged rows don't count", () => {
    const rows = [tx({ date: "2026-09-20" }), tx({ date: "2026-10-22", deletedAt: "2026-10-23T00:00:00.000Z" }), tx({ date: "2026-10-25", purgedAt: "2026-10-26T00:00:00.000Z" } as Partial<StoredTransaction>)];
    expect(quickRecurringStart("Netflix", rows, undefined, TODAY)).toBe("2026-10-20");
  });
  it("no payment with that name and none on screen: today, as before", () => {
    expect(quickRecurringStart("Netflix", [tx({ description: "Spotify" })], undefined, TODAY)).toBe(TODAY);
  });
  it("the same day next month, clamped to the month's end; the year turns", () => {
    const at = (d: string) => quickRecurringStart("Netflix", [], d, TODAY);
    expect(at("2027-01-31")).toBe("2027-02-28");
    expect(at("2028-01-31")).toBe("2028-02-29");
    expect(at("2026-10-31")).toBe("2026-11-30");
    expect(at("2026-11-30")).toBe("2026-12-30");
    expect(at("2026-12-31")).toBe("2027-01-31");
  });
});
