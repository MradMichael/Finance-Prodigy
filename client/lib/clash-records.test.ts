// Plan H 5d, amended (owner, session 6): the notice about a change both
// devices made reaches the device whose edit was overridden.
//
// When a merge settles a two-sided clash it records it in the synced copy:
// an id, when, the key, the kind, and what was kept and what the other
// device had. Any device that then holds a copy with a record it hasn't
// shown shows the same sentence, once: each device remembers what it has
// shown (lib/clashNotice.ts), on the device only. Records are pruned from
// the copy 30 days after the merge that made them; a device shows none
// older than that.
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "./localData";
import { mergeFinancials, type ClashRecord } from "./syncMerge";
import { seenOf } from "./syncSeen";
import { takeUnseenClashes } from "./clashNotice";
import { clashSentence } from "./syncService";
import { activateSessionKey } from "./crypto";

const T0 = new Date("2026-10-08T12:00:00.000Z");
const day = 86_400_000;
const goal = (o: Partial<StoredGoal> = {}): StoredGoal => ({
  id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01",
  createdAt: "2026-05-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...o,
});
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, goals: [goal()], ...o }) as LocalFinancials;
const BASE = base();
const income = (value: number, at: string) => base({ income: value, settingsUpdatedAt: { income: at } });

beforeEach(() => { localStorage.clear(); activateSessionKey(new Uint8Array(32).fill(7)); });

describe("a merge that settles a clash records it in the copy", () => {
  it("a setting: key, kind, what was kept and what the other device had, an id and when", () => {
    const r = mergeFinancials(income(3500, "2026-10-08T10:00:00.000Z"), income(3600, "2026-10-08T11:00:00.000Z"), T0, seenOf(BASE));
    expect(r.data.clashRecords).toEqual([
      { id: expect.any(String), at: T0.toISOString(), key: "income", kind: "setting", setting: "income", kept: 3600, other: 3500 },
    ]);
  });

  it("a goal: its id as the key, its name, and whether the kept change was the later", () => {
    const r = mergeFinancials(base({ goals: [goal({ name: "Laptop Pro", updatedAt: "2026-10-05T00:00:00.000Z" })] }), base({ goals: [goal({ name: "MacBook", updatedAt: "2026-10-06T00:00:00.000Z" })] }), T0, seenOf(BASE));
    expect(r.data.clashRecords).toEqual([{ id: expect.any(String), at: T0.toISOString(), key: "g1", kind: "goal", name: "MacBook", later: true }]);
  });

  it("the same clash gets the same id whichever device merges it, so it is kept once", () => {
    const a = income(3500, "2026-10-08T10:00:00.000Z"), b = income(3600, "2026-10-08T11:00:00.000Z");
    const one = mergeFinancials(a, b, T0, seenOf(BASE)).data, two = mergeFinancials(b, a, new Date(T0.getTime() + 60_000), seenOf(BASE)).data;
    expect(one.clashRecords![0].id).toBe(two.clashRecords![0].id);
    expect(mergeFinancials(one, two, T0, seenOf(one)).data.clashRecords).toHaveLength(1);
  });

  it("a change on one side only records nothing", () => {
    expect(mergeFinancials(BASE, income(3600, "2026-10-08T11:00:00.000Z"), T0, seenOf(BASE)).data.clashRecords ?? []).toEqual([]);
  });

  it("records from both copies are kept; one more than 30 days old is pruned", () => {
    const rec = (id: string, at: Date): ClashRecord => ({ id, at: at.toISOString(), key: "income", kind: "setting", setting: "income", kept: 1, other: 2 });
    const fresh = rec("fresh", new Date(T0.getTime() - 29 * day)), old = rec("old", new Date(T0.getTime() - 31 * day)), other = rec("other", new Date(T0.getTime() - day));
    const r = mergeFinancials(base({ clashRecords: [fresh, old] }), base({ clashRecords: [other] }), T0, seenOf(BASE));
    expect(r.data.clashRecords!.map((x) => x.id).sort()).toEqual(["fresh", "other"]);
  });
});

describe("the overridden device is told, once (owner\x27s order: B uploads, A merges and wins, B fetches)", () => {
  const SENTENCE = "Both devices changed your income — kept $3,600 (the other device had $3,500).";

  it("both devices show the same sentence, each once", async () => {
    // Both devices last synced at BASE. B changes income and uploads: the server now holds B\x27s copy.
    const b = income(3500, "2026-10-08T10:00:00.000Z");
    // A, which hasn\x27t seen that, changes it later; its push meets the conflict merge, and its change wins.
    const a = income(3600, "2026-10-08T11:00:00.000Z");
    const aMerged = mergeFinancials(a, b, T0, seenOf(BASE)).data;
    expect(aMerged.income).toBe(3600);
    expect((await takeUnseenClashes("uA", aMerged, T0)).map(clashSentence)).toEqual([SENTENCE]);
    // B fetches A\x27s merged copy: for B the change is one-sided, so the merge itself names nothing new...
    const fetched = mergeFinancials(b, aMerged, T0, seenOf(b));
    expect(fetched.clashes).toEqual([]);
    expect(fetched.data.income).toBe(3600);
    // ...but the record arrives with the copy, and B shows it.
    expect((await takeUnseenClashes("uB", fetched.data, T0)).map(clashSentence)).toEqual([SENTENCE]);
    // Once per device: neither shows it again.
    expect(await takeUnseenClashes("uB", fetched.data, T0)).toEqual([]);
    expect(await takeUnseenClashes("uA", fetched.data, T0)).toEqual([]);
  });

  it("the device\x27s memory is on the device, encrypted, and survives a reload", async () => {
    const merged = mergeFinancials(income(3500, "2026-10-08T10:00:00.000Z"), income(3600, "2026-10-08T11:00:00.000Z"), T0, seenOf(BASE)).data;
    await takeUnseenClashes("uB", merged, T0);
    const raw = localStorage.getItem("essa_clashes_shown_uB")!;
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(merged.clashRecords![0].id);
    expect(await takeUnseenClashes("uB", structuredClone(merged), new Date(T0.getTime() + day))).toEqual([]);
  });

  it("a record more than 30 days old is not shown: it is on its way out of the copy", async () => {
    const old: ClashRecord = { id: "old", at: new Date(T0.getTime() - 31 * day).toISOString(), key: "income", kind: "setting", setting: "income", kept: 1, other: 2 };
    expect(await takeUnseenClashes("uB", base({ clashRecords: [old] }), T0)).toEqual([]);
  });

  it("several, in the order they were settled", async () => {
    const rec = (id: string, at: number, kept: number): ClashRecord => ({ id, at: new Date(T0.getTime() - at).toISOString(), key: "income", kind: "setting", setting: "income", kept, other: 1 });
    const out = await takeUnseenClashes("uB", base({ clashRecords: [rec("second", 1000, 2), rec("first", 5000, 1)] }), T0);
    expect(out.map((r) => r.id)).toEqual(["first", "second"]);
  });
});
