// Session 12, item 2 (owner): a reset keeps every change a device made since
// its own last sync, settings included, judged clock-free against that
// device's record of its last sync (fingerprint base), the same way for items
// and settings. Session 11's version kept a setting only when this device's
// edit time was later than the reset's moment: two devices' clocks. That
// comparison is gone; so is ordering two devices' reset moments (a reset is
// new to a device when its copy doesn't already carry that reset).
//
// Each device's merge is mergeFinancials(its copy, the server's, now, its
// record), as fetchAndMerge and the conflict merge call it.
import { describe, it, expect } from "vitest";
import { resetFinancials, recordDeletion, DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";
import { buildMergeNoticeText } from "./syncService";

const RESET = new Date("2026-10-09T12:00:00.000Z"); // midday UTC: one calendar day in every zone the suite runs
const NOW = new Date("2026-10-09T15:00:00.000Z");
const ON = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const tx = (id: string, amount = 46.8): StoredTransaction => ({ id, amount, currency: "USD", bucket: "WANTS", category: "dining", description: id, date: "2026-10-01", updatedAt: "2026-10-01T12:00:00.000Z" } as StoredTransaction);
const goal = (name: string) => ({ id: "g1", name, emoji: "💻", targetAmount: 1200, currentAmount: 300, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" });
/** What both devices last synced. */
const synced = { ...DEFAULT_DATA, ...ON, income: 3000, transactions: [tx("t-kept"), tx("t-edited")], goals: [goal("Laptop")] } as unknown as LocalFinancials;
const R2 = "Your other device reset all data on 09/10/2026. This device now matches it, except for changes made here that hadn't been backed up yet.";
const R1 = "Your other device reset all data on 09/10/2026. This device now matches it.";

describe("the owner's case: B changes income, unsynced; A resets; B syncs", () => {
  const b = { ...synced, income: 4000 } as LocalFinancials;           // B's change, not yet backed up
  const aReset = resetFinancials(synced, RESET);                        // A's reset, uploaded
  const bMerge = mergeFinancials(b, aReset, NOW, seenOf(synced));       // B's next sync

  it("B keeps its income, and everything else is reset", () => {
    expect(bMerge.data.income).toBe(4000);
    expect(bMerge.data.transactions.filter((t) => !t.deletedAt)).toEqual([]);
    expect(bMerge.data.goals).toEqual([]);
  });

  it("B is told with R2", () => {
    expect(bMerge.resetElsewhere).toEqual({ at: RESET.toISOString(), kept: true });
    expect(buildMergeNoticeText(0, [], bMerge.clashes, [], [], [], bMerge.resetElsewhere).text).toBe(R2);
  });

  it("A converges to B's income, and isn't told of a reset (it ran it)", () => {
    // B's merged copy goes up; A's record is its own reset copy (its last upload).
    const aMerge = mergeFinancials(aReset, bMerge.data, NOW, seenOf(aReset));
    expect(aMerge.data.income).toBe(4000);
    expect(aMerge.resetElsewhere).toBeUndefined();
    expect(aMerge.clashes).toEqual([]);
  });
});

describe("clock-free: edit times and the reset's moment are never compared", () => {
  const aReset = resetFinancials(synced, RESET);

  it("a change since the last sync is kept even when its edit time reads before the reset (a slow clock)", () => {
    const b = { ...synced, income: 4000, settingsUpdatedAt: { income: "2026-10-09T08:00:00.000Z" } } as LocalFinancials;
    expect(mergeFinancials(b, aReset, NOW, seenOf(synced)).data.income).toBe(4000);
  });

  it("an unchanged setting is reset even when its edit time reads after the reset (a fast clock)", () => {
    const b = { ...synced, settingsUpdatedAt: { income: "2026-10-09T23:00:00.000Z" } } as LocalFinancials;
    const r = mergeFinancials(b, aReset, NOW, seenOf(synced));
    expect(r.data.income).toBe(0);
    expect(r.resetElsewhere).toEqual({ at: RESET.toISOString(), kept: false });
  });

  it("a new reset whose moment reads earlier than one this device already took still applies (a slow clock)", () => {
    // B took C's reset (stamped 13:00), then set its income and synced. A then resets with a clock running behind (11:00).
    const afterC = { ...resetFinancials(synced, new Date("2026-10-09T13:00:00.000Z")), income: 5000 } as LocalFinancials;
    const aSlow = resetFinancials(afterC, new Date("2026-10-09T11:00:00.000Z"));
    const r = mergeFinancials(afterC, aSlow, NOW, seenOf(afterC));
    expect(r.data.income).toBe(0);
    expect(r.data.resetAt).toBe(aSlow.resetAt); // the reset taken is the one this copy now carries
    expect(r.resetElsewhere).toEqual({ at: aSlow.resetAt, kept: false });
  });

  it("a device that took one reset meets another device's earlier one: nothing here is lost or told", () => {
    // B reset (13:00) before its upload went up; the server holds A's reset (12:00).
    const bOwn = resetFinancials(synced, new Date("2026-10-09T13:00:00.000Z"));
    const r = mergeFinancials(bOwn, aReset, NOW, seenOf(synced));
    expect(r.data.income).toBe(0);
    expect(r.data.goals).toEqual([]);
    expect(r.resetElsewhere).toBeUndefined();
  });
});

describe("items: the same rule", () => {
  const aReset = resetFinancials(synced, RESET);
  const b = { ...synced, transactions: [tx("t-kept"), tx("t-edited", 99)], goals: [goal("MacBook")] } as unknown as LocalFinancials;
  const bMerge = mergeFinancials(b, aReset, NOW, seenOf(synced));

  it("an item B changed since its last sync is kept; one it didn't change is reset", () => {
    expect(bMerge.data.transactions.filter((t) => !t.deletedAt).map((t) => [t.id, t.amount])).toEqual([["t-edited", 99]]);
    expect(bMerge.data.goals.map((g) => g.name)).toEqual(["MacBook"]);
    expect(bMerge.resetElsewhere?.kept).toBe(true);
  });

  it("A converges: it takes B's changed items, though it reset them", () => {
    const aMerge = mergeFinancials(aReset, bMerge.data, NOW, seenOf(aReset));
    expect(aMerge.data.transactions.filter((t) => !t.deletedAt).map((t) => [t.id, t.amount])).toEqual([["t-edited", 99]]);
    expect(aMerge.data.goals.map((g) => g.name)).toEqual(["MacBook"]);
  });

  it("only the reset's own deletions give way: an ordinary delete from the other device still wins over an edit here", () => {
    const two = { ...synced, goals: [goal("Laptop"), { ...goal("Camera"), id: "g2" }] } as unknown as LocalFinancials;
    const deletedFirst = { ...two, goals: [goal("Laptop")], deletedKeys: recordDeletion(two, "goals", "g2", new Date("2026-10-09T09:00:00.000Z")) } as LocalFinancials;
    const aReset = resetFinancials(deletedFirst, RESET); // A deleted g2 at 09:00, then reset at 12:00
    const bEditsG2 = { ...two, goals: [goal("Laptop"), { ...goal("Camera Pro"), id: "g2" }] } as unknown as LocalFinancials;
    const r = mergeFinancials(bEditsG2, aReset, NOW, seenOf(two));
    expect(r.data.goals).toEqual([]);
  });

  it("and a later reset still clears them", () => {
    const aMerge = mergeFinancials(aReset, bMerge.data, NOW, seenOf(aReset));
    const again = resetFinancials(aMerge.data, new Date("2026-10-10T12:00:00.000Z"));
    const r = mergeFinancials(bMerge.data, again, new Date("2026-10-10T15:00:00.000Z"), seenOf(bMerge.data));
    expect(r.data.transactions.filter((t) => !t.deletedAt)).toEqual([]);
    expect(r.data.goals).toEqual([]);
  });
});

describe("with no record of a last sync", () => {
  it("nothing can be shown to be unsynced, so the reset is taken whole (R1)", () => {
    const b = { ...synced, income: 4000 } as LocalFinancials;
    const r = mergeFinancials(b, resetFinancials(synced, RESET), NOW, null);
    expect(r.data.income).toBe(0);
    expect(r.resetElsewhere).toEqual({ at: RESET.toISOString(), kept: false });
    expect(buildMergeNoticeText(0, [], r.clashes, [], [], [], r.resetElsewhere).text).toBe(R1);
  });
});
