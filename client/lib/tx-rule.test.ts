// Item 7 (owner, session 8): transactions onto the fingerprint rule (plan H's
// rule, FIX_PLANS "PLAN ONLY (session 5, item 7)"). Per transaction id, after
// the deletion/purge/revival checks (pinned in tx-rule.pins.test.ts):
//   the same on both sides -> keep it;
//   changed on one side only since this device's last sync -> that side, no
//     clock compared, not a conflict;
//   changed on both -> the later edit, a tie to the content tie-break, named
//     (today's approved transaction sentences) and kept as a clash record, so
//     the overridden device is told in the same words (owner: via clash
//     records).
// The fingerprint leaves out fields only a migration adds (goalAmount,
// lbpRateAtEntry), so a migration on one device isn't "changed everything".
// One-sided edits from the other device inside a closed cycle are named
// (owner; the wording is a DRAFT, lib/closedEditNotice.ts).
import { describe, it, expect } from "vitest";
import { mergeFinancials } from "./syncMerge";
import { seenOf, type SeenMap } from "./syncSeen";
import { buildMergeNoticeText } from "./syncService";
import { mergeTransactions, DEFAULT_DATA, type LocalFinancials, type StoredTransaction, type PeriodClose, type StoredCard } from "./localData";
import { CLOSED_EDIT_SENTENCE } from "./closedEditNotice";
import { takeUnseenClashes } from "./clashNotice";
import { activateSessionKey } from "./crypto";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const KEBAB = {
  id: "t-kebab", amount: 18.5, currency: "USD", bucket: "WANTS", category: "dining",
  description: "Kebab at Barbar", date: "2026-10-03", updatedAt: "2026-10-03T10:00:00.000Z",
} as StoredTransaction;
const copy = (txs: StoredTransaction[], extra: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, transactions: txs, ...extra }) as LocalFinancials;
const at = (t: StoredTransaction, updatedAt: string, extra: Partial<StoredTransaction> = {}) => ({ ...t, ...extra, updatedAt });
const kebab = (r: ReturnType<typeof mergeFinancials>) => r.data.transactions.find((t) => t.id === KEBAB.id)!;
const both = (local: LocalFinancials, server: LocalFinancials, seen: SeenMap | null) => [mergeFinancials(local, server, NOW, seen), mergeFinancials(server, local, NOW, seen)];

const LAST = copy([KEBAB]);           // what both devices last synced
const SEEN = seenOf(LAST);

describe("changed on one side only: that side, no clock compared, not a conflict", () => {
  it("this device's edit, stamped by a clock 10 minutes slow, is kept", () => {
    const mine = at(KEBAB, "2026-10-03T09:50:00.000Z", { amount: 21 }); // earlier than the unchanged copy's time
    const r = mergeFinancials(copy([mine]), copy([KEBAB]), NOW, SEEN);
    expect(kebab(r)).toEqual(mine);
    expect(r.transactions.conflictsResolved).toBe(0);
  });

  it("the other device's edit, stamped by a clock 10 minutes slow, is taken", () => {
    const theirs = at(KEBAB, "2026-10-03T09:50:00.000Z", { amount: 21 });
    const r = mergeFinancials(copy([KEBAB]), copy([theirs]), NOW, SEEN);
    expect(kebab(r)).toEqual(theirs);
    expect(r.transactions.conflictsResolved).toBe(0);
  });

  it("a fast clock on the unchanged side never wins: its time is from before the last sync", () => {
    const fast = at(KEBAB, "2026-10-03T10:10:00.000Z"); // stamped 10 minutes fast, then synced
    const last = copy([fast]);
    const theirs = at(fast, "2026-10-03T10:05:00.000Z", { amount: 21 }); // a real later edit, honest clock
    const [a, b] = both(copy([fast]), copy([theirs]), seenOf(last));
    expect(kebab(a)).toEqual(theirs);
    expect(kebab(b)).toEqual(theirs);
    expect(a.transactions.conflictsResolved + b.transactions.conflictsResolved).toBe(0);
  });

  it("a one-sided change isn't named and leaves no clash record", () => {
    const theirs = at(KEBAB, "2026-10-03T09:50:00.000Z", { amount: 21 });
    const r = mergeFinancials(copy([KEBAB]), copy([theirs]), NOW, SEEN);
    expect(buildMergeNoticeText(r.transactions.addedFromServer, []).text).toBe("");
    expect((r.data.transactionClashRecords ?? [])).toEqual([]);
  });
});

describe("changed on both sides: the later edit, named, and recorded for the other device", () => {
  const mine = at(KEBAB, "2026-10-04T10:00:00.000Z", { amount: 21 });
  const theirs = at(KEBAB, "2026-10-05T10:00:00.000Z", { amount: 25 });

  it("the later edit wins from either side, reported as a conflict", () => {
    const [a, b] = both(copy([mine]), copy([theirs]), SEEN);
    expect(kebab(a)).toEqual(theirs);
    expect(kebab(b)).toEqual(theirs);
    expect(a.transactions.conflictsResolved).toBe(1);
  });

  it("the copy keeps a clash record of it, the same one whichever device merged", () => {
    const [a, b] = both(copy([mine]), copy([theirs]), SEEN);
    const ra = (a.data.transactionClashRecords ?? []);
    const rb = (b.data.transactionClashRecords ?? []);
    expect(ra).toHaveLength(1);
    expect(ra[0]).toMatchObject({ kind: "transaction", key: KEBAB.id, name: "Kebab at Barbar", kept: 25, other: 21, how: "newer" });
    expect(rb.map((r) => r.id)).toEqual(ra.map((r) => r.id));
  });

  it("the overridden device's notice path finds the record (takeUnseenClashes), once", async () => {
    localStorage.clear();
    activateSessionKey(new Uint8Array(32).fill(7));
    const merged = mergeFinancials(copy([theirs]), copy([mine]), NOW, SEEN);
    expect((await takeUnseenClashes("u-other", merged.data, NOW)).map((r) => r.kind)).toEqual(["transaction"]);
    expect(await takeUnseenClashes("u-other", merged.data, NOW)).toEqual([]);
  });

  it("the records are kept apart from the other clash records, where older code doesn't look", () => {
    // Older code words every clashRecords entry with clashSentence, which has
    // no "transaction" kind: on a stale tab it would say 'undefined'.
    const [a] = both(copy([mine]), copy([theirs]), SEEN);
    expect((a.data.clashRecords ?? []).some((c) => c.kind === "transaction")).toBe(false);
    expect(a.data.transactionClashRecords).toHaveLength(1);
  });

  it("the overridden device is told in the merging device's own approved words", () => {
    const merged = mergeFinancials(copy([theirs]), copy([mine]), NOW, SEEN); // the device that kept its edit
    const onMerger = buildMergeNoticeText(0, merged.transactions.conflicts.map((w) => ({ winner: w, loser: mine }))).text;
    const record = (merged.data.transactionClashRecords ?? []);
    const onOverridden = buildMergeNoticeText(0, [], record).text;
    expect(onOverridden).toBe(onMerger);
    expect(onOverridden).toBe('Merged with your other device — kept the newer edit to "Kebab at Barbar" ($25, was $21).');
  });

  it("the merging device names it once, not again from its own record", () => {
    const merged = mergeFinancials(copy([theirs]), copy([mine]), NOW, SEEN);
    const record = (merged.data.transactionClashRecords ?? []);
    const text = buildMergeNoticeText(0, merged.transactions.conflicts.map((w) => ({ winner: w, loser: mine })), record).text;
    expect(text.match(/Kebab at Barbar/g)).toHaveLength(1);
  });

  it("a tie (the same edit time) reaches the overridden device in the tie sentence", () => {
    const mineTie = at(KEBAB, "2026-10-05T10:00:00.000Z", { amount: 21 });
    const theirsTie = at(KEBAB, "2026-10-05T10:00:00.000Z", { amount: 25 });
    const merged = mergeFinancials(copy([mineTie]), copy([theirsTie]), NOW, SEEN);
    const winner = kebab(merged), loser = winner.amount === 25 ? mineTie : theirsTie;
    const record = (merged.data.transactionClashRecords ?? []);
    expect(record[0]).toMatchObject({ how: "tie" });
    expect(buildMergeNoticeText(0, [], record).text).toBe(buildMergeNoticeText(0, [{ winner, loser }]).text);
    expect(buildMergeNoticeText(0, [], record).text).toMatch(/^Both devices changed "Kebab at Barbar" at the same moment/);
  });

  it("both edited to the same content is no conflict", () => {
    const same = at(KEBAB, "2026-10-04T10:00:00.000Z", { amount: 21 });
    const r = mergeFinancials(copy([same]), copy([{ ...same }]), NOW, SEEN);
    expect(r.transactions.conflictsResolved).toBe(0);
  });
});

describe("no record, or none for transactions: today's merge exactly", () => {
  // Random pairs: with no record the merged transactions are mergeTransactions' own, unruled.
  const rand = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  it("over 300 random pairs, the same result as today's mergeTransactions", () => {
    const r = rand(7);
    for (let i = 0; i < 300; i++) {
      const pick = () => at(KEBAB, new Date(Date.UTC(2026, 9, 3, 10, Math.floor(r() * 30))).toISOString(), { amount: Math.round(r() * 3) + 18 });
      const l = r() < 0.2 ? KEBAB : pick(), s = r() < 0.2 ? KEBAB : pick();
      const today = mergeTransactions([l], [s]);
      const merged = mergeFinancials(copy([l]), copy([s]), NOW, null);
      expect(merged.data.transactions).toEqual(today.transactions);
      expect(merged.transactions.conflictsResolved).toBe(today.conflictsResolved);
    }
  });

  it("a record written before transactions were fingerprinted merges transactions as today", () => {
    const old: SeenMap = { v: 1, kinds: { ...SEEN.kinds, transactions: undefined } };
    const theirs = at(KEBAB, "2026-10-03T09:50:00.000Z", { amount: 21 }); // slow clock: today's rule keeps the newer, unchanged copy
    const r = mergeFinancials(copy([KEBAB]), copy([theirs]), NOW, old);
    expect(kebab(r)).toEqual(KEBAB);
    expect(r.transactions.conflictsResolved).toBe(1);
  });
});

describe("what isn't an edit", () => {
  it("a migration on one device only (goalAmount, lbpRateAtEntry added) isn't 'this device changed everything'", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ ...KEBAB, id: `t${i}`, currency: "LBP", amount: 450000 + i, goalId: "g1" }) as StoredTransaction);
    const migrated = rows.map((t) => ({ ...t, goalAmount: 5 + t.amount / 89500, lbpRateAtEntry: 89500 }));
    const [a, b] = both(copy(migrated), copy(rows), seenOf(copy(rows)));
    expect(a.transactions.conflictsResolved + b.transactions.conflictsResolved).toBe(0);
    expect(a.data.transactions).toEqual(b.data.transactions);
    expect((a.data.clashRecords ?? []).length + (a.data.transactionClashRecords ?? []).length).toBe(0);
  });

  it("migrated here, really edited there: the edit is taken, not a conflict", () => {
    const row = { ...KEBAB, currency: "LBP", amount: 450000, goalId: "g1" } as StoredTransaction;
    const migrated = { ...row, goalAmount: 5.03, lbpRateAtEntry: 89500 };
    const theirs = at(row, "2026-10-03T09:50:00.000Z", { amount: 500000 }); // a real edit, slow clock
    const r = mergeFinancials(copy([migrated]), copy([theirs]), NOW, seenOf(copy([row])));
    expect(kebab(r)).toEqual(theirs);
    expect(r.transactions.conflictsResolved).toBe(0);
  });

  it("a card remap, applied to both copies by the merge, isn't taken for an edit beside a one-sided one", () => {
    const keep = { id: "c-keep", type: "Visa", last4: "4242", label: "Visa •••• 4242", createdAt: "2026-01-01T00:00:00.000Z" } as StoredCard;
    const dup = { id: "c-dup", type: "Visa", last4: "4242", label: "Visa •••• 4242", createdAt: "2026-05-01T00:00:00.000Z" } as StoredCard;
    const onCard = { ...KEBAB, cardId: "c-dup", cardLabel: dup.label } as StoredTransaction;
    const last = copy([onCard], { cards: [keep, dup] });
    const theirs = at(onCard, "2026-10-03T09:50:00.000Z", { amount: 21 }); // one-sided, slow clock
    const r = mergeFinancials(copy([onCard], { cards: [dup] }), copy([theirs], { cards: [keep] }), NOW, seenOf(last));
    expect(kebab(r)).toMatchObject({ amount: 21, cardId: "c-keep" });
    expect(r.transactions.conflictsResolved).toBe(0);
  });
});

describe("one-sided edits from the other device inside a closed cycle are named (DRAFT wording)", () => {
  const SEPT = { cycleKey: "2026-09", rangeStart: "2026-09-01", rangeEnd: "2026-09-30", startDayAtClose: 1, closedAt: "2026-10-01T09:00:00.000Z", accounts: [] } as unknown as PeriodClose;
  const inSept = { ...KEBAB, date: "2026-09-20" } as StoredTransaction;
  const closed = (txs: StoredTransaction[]) => copy(txs, { periodCloses: [SEPT] });

  it("the other device's edit to a September row, September closed: taken, and named", () => {
    const theirs = at(inSept, "2026-10-04T10:00:00.000Z", { amount: 21 });
    const r = mergeFinancials(closed([inSept]), closed([theirs]), NOW, seenOf(closed([inSept])));
    expect(kebab(r)).toEqual(theirs);
    expect(r.closedEdits).toEqual([{ description: "Kebab at Barbar", amount: 21, currency: "USD", cycleLabel: "Sep 2026" }]); // the cycle label the close notices already use (cycleLabelLong)
    expect(buildMergeNoticeText(0, [], [], [], [], r.closedEdits).text).toBe(CLOSED_EDIT_SENTENCE(r.closedEdits[0]));
  });

  it("this device's own edit there isn't named here (the other device names it when it merges)", () => {
    const mine = at(inSept, "2026-10-04T10:00:00.000Z", { amount: 21 });
    const r = mergeFinancials(closed([mine]), closed([inSept]), NOW, seenOf(closed([inSept])));
    expect(r.closedEdits).toEqual([]);
  });

  it("an edit outside any closed cycle isn't named", () => {
    const theirs = at(KEBAB, "2026-10-04T10:00:00.000Z", { amount: 21 }); // October, open
    const r = mergeFinancials(closed([KEBAB]), closed([theirs]), NOW, seenOf(closed([KEBAB])));
    expect(r.closedEdits).toEqual([]);
  });

  it("a reopened cycle isn't closed", () => {
    const reopened = { ...SEPT, reopenedAt: "2026-10-02T09:00:00.000Z" } as unknown as PeriodClose;
    const theirs = at(inSept, "2026-10-04T10:00:00.000Z", { amount: 21 });
    const r = mergeFinancials(copy([inSept], { periodCloses: [reopened] }), copy([theirs], { periodCloses: [reopened] }), NOW, seenOf(copy([inSept], { periodCloses: [reopened] })));
    expect(r.closedEdits).toEqual([]);
  });
});
