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
  // 2.8.5e (owner, session 42): sentences 5 and 6 never show a signed figure;
  // the action is named by account and direction (re-derived in
  // concurrent-corrections.test.ts from real rows).
  const crossed = (o: object) => c({ how: "crossed", other: null, ...o });
  it("5, debt: a payment", () => {
    expect(correctionSentence(crossed({ account: "debt", key: "debt:d2", name: "Loan", currency: "LBP", kept: 90_000_000, moved: -1_000_000, movedCount: 1, movedDirection: "down", result: 89_000_000 }))).toBe('One device set the debt "Loan" to L£90,000,000 while the other recorded a payment of L£1,000,000. ESSA kept both, so it now shows L£89,000,000. If L£90,000,000 was right, correct it once more.');
  });
  it("5, goal: a contribution", () => {
    expect(correctionSentence(crossed({ kept: 600, moved: 50, movedCount: 1, movedDirection: "up", result: 650 }))).toBe('One device set the goal "Laptop" to $600 while the other recorded a contribution of $50. ESSA kept both, so it now shows $650. If $600 was right, correct it once more.');
  });
  it("5, safety net: a deposit, and a withdrawal", () => {
    const ef = { account: "ef", key: "ef", name: "Safety net", kept: 900 };
    expect(correctionSentence(crossed({ ...ef, moved: 200, movedCount: 1, movedDirection: "up", result: 1100 }))).toBe("One device set your safety net to $900 while the other recorded a deposit of $200. ESSA kept both, so it now shows $1,100. If $900 was right, correct it once more.");
    expect(correctionSentence(crossed({ ...ef, moved: -300, movedCount: 1, movedDirection: "down", result: 600 }))).toBe("One device set your safety net to $900 while the other recorded a withdrawal of $300. ESSA kept both, so it now shows $600. If $900 was right, correct it once more.");
  });
  it("5, several in one direction: a count and a total", () => {
    expect(correctionSentence(crossed({ account: "debt", key: "debt:d1", name: "Car", kept: 5000, moved: -150, movedCount: 2, movedDirection: "down", result: 4850 }))).toBe('One device set the debt "Car" to $5,000 while the other recorded 2 payments totalling $150. ESSA kept both, so it now shows $4,850. If $5,000 was right, correct it once more.');
  });
  it("5, the other way: a debt increase, a goal decrease", () => {
    expect(correctionSentence(crossed({ account: "debt", key: "debt:d1", name: "Car", kept: 5000, moved: 100, movedCount: 1, movedDirection: "up", result: 5100 }))).toBe('One device set the debt "Car" to $5,000 while the other recorded an increase of $100. ESSA kept both, so it now shows $5,100. If $5,000 was right, correct it once more.');
    expect(correctionSentence(crossed({ kept: 600, moved: -50, movedCount: 1, movedDirection: "down", result: 550 }))).toBe('One device set the goal "Laptop" to $600 while the other recorded a decrease of $50. ESSA kept both, so it now shows $550. If $600 was right, correct it once more.');
  });
  it("5, mixed: named by the net change, an increase or a decrease", () => {
    expect(correctionSentence(crossed({ account: "ef", key: "ef", name: "Safety net", kept: 900, moved: -100, movedCount: 2, movedDirection: "mixed", result: 800 }))).toBe("One device set your safety net to $900 while the other recorded a decrease of $100. ESSA kept both, so it now shows $800. If $900 was right, correct it once more.");
    expect(correctionSentence(crossed({ account: "ef", key: "ef", name: "Safety net", kept: 900, moved: 100, movedCount: 2, movedDirection: "mixed", result: 1000 }))).toBe("One device set your safety net to $900 while the other recorded an increase of $100. ESSA kept both, so it now shows $1,000. If $900 was right, correct it once more.");
  });
  it("6, figure unknown, the same words: a contribution, a payment, a deposit, a withdrawal, an increase", () => {
    const six = (o: object) => correctionSentence(crossed({ kept: null, movedCount: 1, ...o }));
    expect(six({ moved: 50, movedDirection: "up", result: 650 })).toBe('One device corrected the goal "Laptop" while the other recorded a contribution of $50. ESSA kept both, so it now shows $650. If that\'s wrong, correct it once more.');
    expect(six({ account: "debt", key: "debt:d2", name: "Loan", currency: "LBP", moved: -1_000_000, movedDirection: "down", result: 89_000_000 })).toBe('One device corrected the debt "Loan" while the other recorded a payment of L£1,000,000. ESSA kept both, so it now shows L£89,000,000. If that\'s wrong, correct it once more.');
    expect(six({ account: "ef", key: "ef", name: "Safety net", moved: 200, movedDirection: "up", result: 1200 })).toBe("One device corrected your safety net while the other recorded a deposit of $200. ESSA kept both, so it now shows $1,200. If that's wrong, correct it once more.");
    expect(six({ account: "ef", key: "ef", name: "Safety net", moved: -300, movedDirection: "down", result: 700 })).toBe("One device corrected your safety net while the other recorded a withdrawal of $300. ESSA kept both, so it now shows $700. If that's wrong, correct it once more.");
    expect(six({ account: "debt", key: "debt:d1", name: "Car", moved: 100, movedDirection: "up", result: 5100 })).toBe('One device corrected the debt "Car" while the other recorded an increase of $100. ESSA kept both, so it now shows $5,100. If that\'s wrong, correct it once more.');
  });
  it("no crossed sentence shows a signed figure", () => {
    for (const [account, dir, moved] of [["ef", "up", 200], ["ef", "down", -300], ["debt", "down", -100], ["debt", "up", 100], ["goal", "up", 50], ["ef", "mixed", -100], ["ef", "mixed", 100], ["goal", "down", -50]] as const) {
      const text = correctionSentence(crossed({ account, key: account, kept: 1000, moved, movedCount: 1, movedDirection: dir, result: 900 }));
      expect(text).not.toMatch(/[−+-]\s?(\$|L£)\d/);
    }
  });
});
