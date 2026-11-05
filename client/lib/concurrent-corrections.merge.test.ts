// Phase 2.8.5d (owner-approved, session 42): settleConcurrentCorrections wired
// into the merge (tests 17-18 of the approved plan). Both devices end on the
// later statement whichever of them merges, the clash is kept in its own
// field (correctionClashRecords: older code words every clashRecords entry
// and has no sentence for it, as with balanceClashRecords), and each device
// says it once. The sentences are DRAFTS (lib/correctionNotice.ts), pinned here
// so the owner's approval (2.8.5e) changes them in one place, deliberately.
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_DATA, goalProgress, buildGoalCorrectionTx, type LocalFinancials, type StoredGoal, type StoredTransaction } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";
import { takeUnseenClashes } from "./clashNotice";
import { clashSentence, buildMergeNoticeText } from "./syncService";
import { activateSessionKey } from "./crypto";
import { correctionSentence } from "./correctionNotice";

const T0 = new Date("2026-11-05T12:00:00.000Z");
const GOAL: StoredGoal = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 500, openingAmount: 500, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" };
const base = (txs: StoredTransaction[] = []) => ({ ...DEFAULT_DATA, income: 3000, goals: [GOAL], transactions: txs }) as LocalFinancials;
const fix = (id: string, at: string, stated: number) =>
  ({ ...buildGoalCorrectionTx(GOAL, stated - 500, { stated, base: 500 }), id, createdAt: at, updatedAt: at });
const BASE = base();
const PHONE = base([fix("p", "2026-11-05T10:00:00.000Z", 600)]);   // the earlier statement
const LAPTOP = base([fix("l", "2026-11-05T10:05:00.000Z", 650)]);  // the later one
const progress = (d: LocalFinancials) => goalProgress(d.goals[0], d);

beforeEach(() => { localStorage.clear(); activateSessionKey(new Uint8Array(32).fill(7)); });

describe("17. two devices correct one goal, then merge", () => {
  it("ends on the later statement, $650 (was $750), and records the clash in its own field", () => {
    const r = mergeFinancials(PHONE, LAPTOP, T0, seenOf(BASE));
    expect(progress(r.data)).toBe(650);
    expect(r.data.transactions.find((t) => t.id === "p")!.deletedAt).toBe(T0.toISOString());
    expect(r.data.correctionClashRecords).toEqual([expect.objectContaining({ kind: "correction", how: "later", key: "goal:g1", name: "Laptop", kept: 650, other: 600, at: T0.toISOString() })]);
    expect(r.clashes).toEqual([expect.objectContaining({ kind: "correction", how: "later", kept: 650, other: 600 })]);
    expect(r.data.clashRecords).toBeUndefined();
  });

  it("holds on a device's first merge too (no record of a last sync)", () => {
    expect(progress(mergeFinancials(PHONE, LAPTOP, T0, null).data)).toBe(650);
  });

  it("the other device, merging the result, ends on $650 with the same single record", () => {
    const merged = mergeFinancials(PHONE, LAPTOP, T0, seenOf(BASE)).data;
    const onLaptop = mergeFinancials(LAPTOP, merged, new Date(T0.getTime() + 60_000), seenOf(LAPTOP)).data;
    expect(progress(onLaptop)).toBe(650);
    expect(onLaptop.correctionClashRecords).toHaveLength(1);
  });

  it("is shown once on each device that holds the record", async () => {
    const merged = mergeFinancials(PHONE, LAPTOP, T0, seenOf(BASE)).data;
    const first = await takeUnseenClashes("phone", merged, T0);
    expect(first.map((c) => clashSentence(c))).toEqual([correctionSentence(merged.correctionClashRecords![0] as never)]);
    expect(await takeUnseenClashes("phone", merged, T0)).toEqual([]);
    expect(await takeUnseenClashes("laptop", merged, T0)).toHaveLength(1);
  });

  it("the merging device's notice says it", () => {
    const r = mergeFinancials(PHONE, LAPTOP, T0, seenOf(BASE));
    expect(buildMergeNoticeText(0, [], r.clashes).text).toContain(correctionSentence(r.clashes[0] as never));
  });
});

describe("18. the earlier statement never wins, whichever device merges", () => {
  it("phone merging laptop, and laptop merging phone, both keep the laptop's later $650", () => {
    expect(progress(mergeFinancials(PHONE, LAPTOP, T0, seenOf(BASE)).data)).toBe(650);
    expect(progress(mergeFinancials(LAPTOP, PHONE, T0, seenOf(BASE)).data)).toBe(650);
  });
});

describe("the draft sentences (2.8.5e approves them)", () => {
  const c = (o: object) => ({ kind: "correction", account: "goal", key: "goal:g1", name: "Laptop", currency: "USD", kept: 650, other: 600, ...o }) as never;
  it("later", () => {
    expect(correctionSentence(c({ how: "later" }))).toBe('Both devices corrected the goal "Laptop" — kept the later figure, $650 (the other device said $600). The other correction is in Recently deleted.');
  });
  it("later, from rows without their figures", () => {
    expect(correctionSentence(c({ how: "later", kept: null, other: null }))).toBe('Both devices corrected the goal "Laptop" — kept the later correction. The other one is in Recently deleted.');
  });
  it("same", () => {
    expect(correctionSentence(c({ how: "same", kept: 600, other: 600 }))).toBe('Both devices corrected the goal "Laptop" to $600 — kept one; the duplicate is in Recently deleted.');
  });
  it("close, for the safety net", () => {
    expect(correctionSentence(c({ how: "close", account: "ef", key: "ef", name: "Safety net", result: 850 }))).toBe("Both devices corrected your safety net, and one of the corrections belongs to a closed cycle, so ESSA kept both: it now shows $850. If that's wrong, correct it once more.");
  });
  it("crossed, for a debt in lira", () => {
    expect(correctionSentence(c({ how: "crossed", account: "debt", key: "debt:d2", name: "Loan", currency: "LBP", kept: 90_000_000, other: null, moved: -1_000_000, result: 89_000_000 }))).toBe('One device set the debt "Loan" to L£90,000,000 while the other recorded a change of −L£1,000,000. ESSA kept both, so it now shows L£89,000,000. If L£90,000,000 was right, correct it once more.');
  });
});
