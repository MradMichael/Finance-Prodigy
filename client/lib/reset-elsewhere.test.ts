// Session 10, item 2 (R1 and R2 approved by the owner, session 11). Another device's
// "Reset all data" reaches this device through a merge, which clears what
// this device held (DI-13's deletion records). The merge now reports it, so
// the notice can say so: only when the reset is later than any this device
// has taken, and only when it cleared something this device held, judged by
// the reset's own moment (resetFinancials stamps resetAt and every deletion
// record alike).
import { describe, it, expect } from "vitest";
import { resetFinancials, recordDeletion, DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";
import { buildMergeNoticeText } from "./syncService";
import { RESET_ELSEWHERE_SENTENCE } from "./resetNotice";

const RESET = new Date("2026-10-09T12:00:00.000Z"); // midday UTC: the same calendar day in every zone the suite runs
const NOW = new Date("2026-10-09T15:00:00.000Z");
const tx = (id: string): StoredTransaction => ({ id, amount: 46.8, currency: "USD", bucket: "WANTS", category: "dining", description: id, date: "2026-10-01", updatedAt: "2026-10-01T12:00:00.000Z" } as StoredTransaction);
const ON = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const held = { ...DEFAULT_DATA, ...ON, income: 3150.75, transactions: [tx("t-bistro"), tx("t-kettle")],
  goals: [{ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 300, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" }] } as unknown as LocalFinancials;

describe("the merge reports another device's reset", () => {
  it("that cleared what this device held: when, and nothing kept", () => {
    const r = mergeFinancials(held, resetFinancials(held, RESET), NOW, seenOf(held));
    expect(r.resetElsewhere).toEqual({ at: RESET.toISOString(), kept: false });
    expect(r.data.resetAt).toBe(RESET.toISOString()); // taken, so not reported again
  });

  it("with something added here since the last sync kept", () => {
    const local = { ...held, transactions: [...held.transactions, tx("t-new")] };
    const r = mergeFinancials(local, resetFinancials(held, RESET), NOW, seenOf(held));
    expect(r.resetElsewhere).toEqual({ at: RESET.toISOString(), kept: true });
    expect(r.data.transactions.filter((t) => !t.deletedAt).map((t) => t.id)).toEqual(["t-new"]);
  });

  it("the same on a first merge, with no record of a last sync", () => {
    const r = mergeFinancials(held, resetFinancials(held, RESET), NOW, null);
    expect(r.resetElsewhere?.at).toBe(RESET.toISOString());
  });
});

describe("and not otherwise", () => {
  it("not on the device that ran it (the same reset on both copies)", () => {
    const reset = resetFinancials(held, RESET);
    expect(mergeFinancials(reset, reset, NOW, seenOf(reset)).resetElsewhere).toBeUndefined();
  });

  it("not once taken: a later merge of the same reset says nothing", () => {
    const first = mergeFinancials(held, resetFinancials(held, RESET), NOW, seenOf(held));
    const again = mergeFinancials(first.data, resetFinancials(held, RESET), NOW, seenOf(first.data));
    expect(again.resetElsewhere).toBeUndefined();
  });

  it("not for an older reset than one this device has taken", () => {
    const mine = { ...held, resetAt: "2026-10-09T13:00:00.000Z" };
    expect(mergeFinancials(mine, resetFinancials(held, RESET), NOW, seenOf(held)).resetElsewhere).toBeUndefined();
  });

  it("not when it cleared nothing this device held", () => {
    const other = { ...held, transactions: [tx("t-elsewhere")], goals: [] } as LocalFinancials;
    const local = { ...DEFAULT_DATA, ...ON, transactions: [tx("t-mine")] } as LocalFinancials;
    const r = mergeFinancials(local, resetFinancials(other, RESET), NOW, null);
    expect(r.resetElsewhere).toBeUndefined();
    expect(r.data.transactions.map((t) => t.id)).toEqual(["t-mine"]);
  });

  it("not for an ordinary delete, recorded at another moment than the reset's", () => {
    const earlierReset = resetFinancials({ ...DEFAULT_DATA, ...ON, transactions: [tx("t-old")] } as LocalFinancials, new Date("2026-09-01T12:00:00.000Z"));
    const server = { ...earlierReset, deletedKeys: recordDeletion(earlierReset, "transactions", "t-bistro", RESET) };
    const tookIt = { ...held, resetAt: earlierReset.resetAt }; // this device took that earlier reset
    const r = mergeFinancials(tookIt, server, NOW, null);
    expect(r.data.transactions.map((t) => t.id)).toEqual(["t-kettle"]); // the delete is taken
    expect(r.resetElsewhere).toBeUndefined();                           // but it isn't the reset
  });

  it("not for a reset copy made before this change (no resetAt): the known limit", () => {
    const { resetAt: _gone, ...old } = resetFinancials(held, RESET);
    expect(mergeFinancials(held, old as LocalFinancials, NOW, seenOf(held)).resetElsewhere).toBeUndefined();
  });
});

// Owner, session 11: settings are reset too ("settings included"), on every
// device, record or not, except a setting changed there after the reset. A
// device that held only settings is told as well: R1 when nothing of its own
// is kept.
describe("settings, everywhere (owner, session 11)", () => {
  const settingsOnly = { ...DEFAULT_DATA, ...ON, income: 3150.75, transactions: [] } as LocalFinancials;
  const after = "2026-10-09T13:00:00.000Z", before = "2026-10-09T11:00:00.000Z";

  it("a device that held only settings takes the reset's, and is told (R1)", () => {
    const r = mergeFinancials(settingsOnly, resetFinancials(settingsOnly, RESET), NOW, seenOf(settingsOnly));
    expect(r.data.income).toBe(0);
    expect(r.resetElsewhere).toEqual({ at: RESET.toISOString(), kept: false });
  });

  it("the same with no record of a last sync", () => {
    const r = mergeFinancials(settingsOnly, resetFinancials(settingsOnly, RESET), NOW, null);
    expect(r.data.income).toBe(0);
    expect(r.resetElsewhere).toEqual({ at: RESET.toISOString(), kept: false });
  });

  it("a full device with no record takes the reset's settings too", () => {
    expect(mergeFinancials(held, resetFinancials(held, RESET), NOW, null).data.income).toBe(0);
  });

  it("a setting changed here before the reset (since the last sync) takes the reset's, and no clash is named", () => {
    const local = { ...settingsOnly, income: 3500, settingsUpdatedAt: { income: before } } as LocalFinancials;
    const r = mergeFinancials(local, resetFinancials(settingsOnly, RESET), NOW, seenOf(settingsOnly));
    expect(r.data.income).toBe(0);
    expect(r.data.settingsUpdatedAt?.income).toBeUndefined(); // the reset's value brings its own edit time (none), not the stale one
    expect(r.clashes).toEqual([]);
    expect(r.data.clashRecords ?? []).toEqual([]);
    expect(r.resetElsewhere).toEqual({ at: RESET.toISOString(), kept: false });
  });

  it("a setting changed here after the reset is kept, and with something cleared the notice is R2", () => {
    const local = { ...held, income: 4000, settingsUpdatedAt: { income: after } } as LocalFinancials;
    const r = mergeFinancials(local, resetFinancials(held, RESET), NOW, seenOf(held));
    expect(r.data.income).toBe(4000);
    expect(r.data.transactions.filter((t) => !t.deletedAt)).toEqual([]);
    expect(r.resetElsewhere).toEqual({ at: RESET.toISOString(), kept: true });
  });

  it("a setting changed here after the reset is kept; with nothing cleared, nothing is told", () => {
    const local = { ...settingsOnly, income: 4000, settingsUpdatedAt: { income: after } } as LocalFinancials;
    const r = mergeFinancials(local, resetFinancials(settingsOnly, RESET), NOW, seenOf(settingsOnly));
    expect(r.data.income).toBe(4000);
    expect(r.resetElsewhere).toBeUndefined();
  });

  it("a kept setting that isn't income still counts as kept (R2)", () => {
    const local = { ...held, cycleStartDay: 27, settingsUpdatedAt: { payday: after } } as LocalFinancials; // payday set here after the reset
    const r = mergeFinancials(local, resetFinancials(held, RESET), NOW, seenOf(held));
    expect(r.data.cycleStartDay).toBe(27);
    expect(r.resetElsewhere?.kept).toBe(true);
  });

  it("once taken, the normal rule again: a later merge doesn't re-apply the reset", () => {
    const first = mergeFinancials(settingsOnly, resetFinancials(settingsOnly, RESET), NOW, seenOf(settingsOnly));
    const edited = { ...first.data, income: 2000, settingsUpdatedAt: { income: "2026-10-09T10:00:00.000Z" } } as LocalFinancials; // an older stamp, but changed since that sync
    const again = mergeFinancials(edited, resetFinancials(settingsOnly, RESET), NOW, seenOf(first.data));
    expect(again.data.income).toBe(2000);
    expect(again.resetElsewhere).toBeUndefined();
  });
});

describe("the notice (owner-approved, session 11)", () => {
  it("R1 and R2, verbatim", () => {
    expect(RESET_ELSEWHERE_SENTENCE({ at: RESET.toISOString(), kept: false })).toBe("Your other device reset all data on 9 Oct 2026. This device now matches it.");
    expect(RESET_ELSEWHERE_SENTENCE({ at: RESET.toISOString(), kept: true })).toBe("Your other device reset all data on 9 Oct 2026. This device now matches it, except for changes made here that hadn't been backed up yet.");
  });

  it("first, before what else the merge did", () => {
    const { text } = buildMergeNoticeText(1, [], [], [], [], [], { at: RESET.toISOString(), kept: true });
    expect(text).toBe("Your other device reset all data on 9 Oct 2026. This device now matches it, except for changes made here that hadn't been backed up yet. Merged with your other device — 1 new transaction added.");
  });

  it("absent, the notice is what it was", () => {
    expect(buildMergeNoticeText(1, [], [], [], [], []).text).toBe("Merged with your other device — 1 new transaction added.");
  });
});
