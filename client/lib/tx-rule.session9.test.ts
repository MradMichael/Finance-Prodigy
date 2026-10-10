// Item 7's rule, finished (owner, session 9):
//   4. every merge sentence shows a lira row's amounts in the app's lira
//      format ("L£450,000"), not fmtMoney dollars;
//   5. closed-cycle naming covers the other device's adds and deletes too
//      (owner's wording), as well as its edits (draft B, approved);
//   6. goal progress when a frozen goalAmount is lost: the contribution is
//      converted at its own cycle's rate, the rate the migration froze it at.
import { describe, it, expect } from "vitest";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";
import { buildMergeNoticeText, clashSentence } from "./syncService";
import { goalProgress, DEFAULT_DATA, type LocalFinancials, type StoredTransaction, type PeriodClose, type StoredGoal } from "./localData";
import { CLOSED_EDIT_SENTENCE } from "./closedEditNotice";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const GEN = {
  id: "t-gen", amount: 450000, currency: "LBP", bucket: "NEEDS", description: "Generator", date: "2026-09-20", updatedAt: "2026-09-20T10:00:00.000Z",
} as StoredTransaction;
const SEPT = { cycleKey: "2026-09", rangeStart: "2026-09-01", rangeEnd: "2026-09-30", startDayAtClose: 1, closedAt: "2026-10-01T09:00:00.000Z", accounts: [] } as unknown as PeriodClose;
const copy = (txs: StoredTransaction[], extra: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, transactions: txs, ...extra }) as LocalFinancials;
const closed = (txs: StoredTransaction[]) => copy(txs, { periodCloses: [SEPT] });
const at = (t: StoredTransaction, updatedAt: string, extra: Partial<StoredTransaction> = {}) => ({ ...t, ...extra, updatedAt });

describe("4. lira amounts in merge sentences", () => {
  const mine = at(GEN, "2026-10-04T10:00:00.000Z", { amount: 500000 });
  const theirs = at(GEN, "2026-10-05T10:00:00.000Z", { amount: 520000 });

  it("a lira clash: the merging device and the overridden one both say L£", () => {
    const merged = mergeFinancials(copy([theirs]), copy([mine]), NOW, seenOf(copy([GEN])));
    const onMerger = buildMergeNoticeText(0, merged.transactions.conflicts.map((w) => ({ winner: w, loser: mine }))).text;
    expect(onMerger).toBe('Merged with your other device — kept the newer edit to "Generator" (L£520,000, was L£500,000).');
    const onOverridden = buildMergeNoticeText(0, [], merged.data.transactionClashRecords ?? []).text;
    expect(onOverridden).toBe(onMerger);
  });

  it("the tie and different-versions sentences too", () => {
    const a = at(GEN, "2026-10-05T10:00:00.000Z", { amount: 500000 }), b = at(GEN, "2026-10-05T10:00:00.000Z", { amount: 520000 });
    expect(buildMergeNoticeText(0, [{ winner: b, loser: a }]).text).toBe('Both devices changed "Generator" at the same moment — kept L£520,000 (the other copy said L£500,000).');
    const { updatedAt: _1, ...na } = a, { updatedAt: _2, ...nb } = b;
    expect(buildMergeNoticeText(0, [{ winner: nb as StoredTransaction, loser: na as StoredTransaction }]).text).toBe('Your devices had different versions of "Generator" — kept L£520,000 (the other copy said L£500,000).');
  });

  it("each amount in its own currency when one side changed the currency", () => {
    const dollars = at(GEN, "2026-10-04T10:00:00.000Z", { amount: 5, currency: "USD" });
    expect(buildMergeNoticeText(0, [{ winner: theirs, loser: dollars }]).text).toBe('Merged with your other device — kept the newer edit to "Generator" (L£520,000, was $5).');
  });

  it("a lira record worded on its own (clashSentence) says L£ too", () => {
    const merged = mergeFinancials(copy([theirs]), copy([mine]), NOW, seenOf(copy([GEN])));
    const [record] = merged.data.transactionClashRecords ?? [];
    expect(clashSentence(record)).toBe('Merged with your other device — kept the newer edit to "Generator" (L£520,000, was L£500,000).');
  });

  it("dollar rows are as before", () => {
    const usd = { ...GEN, currency: "USD", amount: 21 } as StoredTransaction;
    expect(buildMergeNoticeText(0, [{ winner: at(usd, "2026-10-05T10:00:00.000Z", { amount: 25 }), loser: at(usd, "2026-10-04T10:00:00.000Z") }]).text)
      .toBe('Merged with your other device — kept the newer edit to "Generator" ($25, was $21).');
  });

  it("a lira edit inside a closed cycle", () => {
    const r = mergeFinancials(closed([GEN]), closed([theirs]), NOW, seenOf(closed([GEN])));
    expect(buildMergeNoticeText(0, [], [], [], [], r.closedEdits).text).toBe("Your other device changed \"Generator\" (L£520,000) in Sep 2026, a cycle you've closed.");
  });
});

describe("5. closed-cycle naming: the other device's adds and deletes", () => {
  const LAMP = { id: "t-lamp", amount: 18, currency: "USD", bucket: "WANTS", description: "Amber lamp", date: "2026-09-12", updatedAt: "2026-09-12T10:00:00.000Z" } as StoredTransaction;

  it("an add inside a closed cycle", () => {
    const r = mergeFinancials(closed([]), closed([LAMP]), NOW, seenOf(closed([])));
    expect(r.closedEdits).toEqual([{ kind: "added", description: "Amber lamp", amount: 18, currency: "USD", cycleLabel: "Sep 2026" }]);
    expect(buildMergeNoticeText(0, [], [], [], [], r.closedEdits).text).toBe("Your other device added \"Amber lamp\" ($18) in Sep 2026, a cycle you've closed.");
  });

  it("a delete inside a closed cycle", () => {
    const gone = { ...LAMP, deletedAt: "2026-10-04T10:00:00.000Z", updatedAt: "2026-10-04T10:00:00.000Z" } as StoredTransaction;
    const r = mergeFinancials(closed([LAMP]), closed([gone]), NOW, seenOf(closed([LAMP])));
    expect(r.data.transactions.find((t) => t.id === LAMP.id)?.deletedAt).toBeTruthy();
    expect(r.closedEdits).toEqual([{ kind: "deleted", description: "Amber lamp", amount: 18, currency: "USD", cycleLabel: "Sep 2026" }]);
    expect(buildMergeNoticeText(0, [], [], [], [], r.closedEdits).text).toBe("Your other device deleted \"Amber lamp\" ($18) in Sep 2026, a cycle you've closed.");
  });

  it("a delete that arrives already purged is named from this device's copy (the purge scrubbed the row)", () => {
    const purged = { id: LAMP.id, amount: 0, currency: "USD", bucket: "WANTS", description: "", date: LAMP.date, deletedAt: "2026-08-01T10:00:00.000Z", purgedAt: "2026-09-02T10:00:00.000Z" } as StoredTransaction;
    const r = mergeFinancials(closed([LAMP]), closed([purged]), NOW, seenOf(closed([LAMP])));
    expect(r.closedEdits).toEqual([{ kind: "deleted", description: "Amber lamp", amount: 18, currency: "USD", cycleLabel: "Sep 2026" }]);
  });

  it("the edit sentence (draft B, approved) is unchanged", () => {
    const edited = at(LAMP, "2026-10-04T10:00:00.000Z", { amount: 21 });
    const r = mergeFinancials(closed([LAMP]), closed([edited]), NOW, seenOf(closed([LAMP])));
    expect(r.closedEdits[0]).toMatchObject({ kind: "changed" });
    expect(CLOSED_EDIT_SENTENCE(r.closedEdits[0])).toBe("Your other device changed \"Amber lamp\" ($21) in Sep 2026, a cycle you've closed.");
  });

  it("not named: this device's own add or delete, a delete revived here, or anything outside a closed cycle", () => {
    const gone = { ...LAMP, deletedAt: "2026-10-04T10:00:00.000Z", updatedAt: "2026-10-04T10:00:00.000Z" } as StoredTransaction;
    expect(mergeFinancials(closed([LAMP]), closed([]), NOW, seenOf(closed([]))).closedEdits).toEqual([]);          // this device added it
    expect(mergeFinancials(closed([gone]), closed([LAMP]), NOW, seenOf(closed([LAMP]))).closedEdits).toEqual([]);   // this device deleted it
    const revived = closed([LAMP]); revived.revivedKeys = { transactions: { [LAMP.id]: 2 } };
    const oldDelete = { ...gone, deletedGen: 1 } as StoredTransaction;
    expect(mergeFinancials(revived, closed([oldDelete]), NOW, seenOf(closed([LAMP]))).closedEdits).toEqual([]);    // revived here: the deletion loses
    const oct = { ...LAMP, id: "t-oct", date: "2026-10-03" } as StoredTransaction;
    expect(mergeFinancials(closed([]), closed([oct]), NOW, seenOf(closed([]))).closedEdits).toEqual([]);           // October, open
  });

  it("not named: a row the other device added and deleted before this device saw it, or one both devices deleted", () => {
    const gone = { ...LAMP, deletedAt: "2026-10-04T10:00:00.000Z", updatedAt: "2026-10-04T10:00:00.000Z" } as StoredTransaction;
    expect(mergeFinancials(closed([]), closed([gone]), NOW, seenOf(closed([]))).closedEdits).toEqual([]);
    const goneHere = { ...LAMP, deletedAt: "2026-10-03T10:00:00.000Z", updatedAt: "2026-10-03T10:00:00.000Z" } as StoredTransaction;
    expect(mergeFinancials(closed([goneHere]), closed([gone]), NOW, seenOf(closed([LAMP]))).closedEdits).toEqual([]);
  });

  it("with no record (a first merge), nothing is named: today's merge", () => {
    expect(mergeFinancials(closed([]), closed([LAMP]), NOW, null).closedEdits).toEqual([]);
  });
});

describe("6. goal progress when an older client drops a frozen goalAmount", () => {
  // A dollar goal, a lira contribution frozen by the v7 migration at its own
  // cycle's rate (rateForMonth over lbpRateHistory, the live rate only where
  // no history covers the cycle).
  const GOAL = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" } as StoredGoal;
  const row = { id: "t-c", amount: 895000, currency: "LBP", bucket: "SAVINGS", description: "To Laptop", date: "2026-09-10", goalId: "g1" } as StoredTransaction;
  const frozen = { ...row, goalAmount: 10 }; // 895,000 at 89,500

  it("with the cycle's rate in the history: progress is the same without the frozen amount", () => {
    const d = (t: StoredTransaction) => ({ ...DEFAULT_DATA, lbpRate: 100000, lbpRateHistory: [{ ym: "2026-09", value: 89500 }], goals: [GOAL], transactions: [t] }) as LocalFinancials;
    expect(goalProgress(GOAL, d(frozen))).toBe(110);
    expect(goalProgress(GOAL, d(row))).toBe(110);
  });

  it("with no history for that cycle: it moves by the conversion difference only (the live rate instead of the frozen one)", () => {
    const d = (t: StoredTransaction) => ({ ...DEFAULT_DATA, lbpRate: 100000, lbpRateHistory: [], goals: [GOAL], transactions: [t] }) as LocalFinancials;
    expect(goalProgress(GOAL, d(frozen))).toBe(110);
    expect(goalProgress(GOAL, d(row))).toBe(108.95); // 895,000 / 100,000: 1.05 less, the conversion difference
  });
});
