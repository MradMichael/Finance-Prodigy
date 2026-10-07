// DI-12 (2026-10-07): two devices purging the same deleted transaction drew a
// merge notice about an empty record.
//
// autoPurgeExpired runs on each device's own load and stamps `purgedAt` with
// that device's `now`, so 30 days after a deletion the two purged copies
// differ only in purgedAt. Same tombstone rank, different content: the merge
// counted a conflict, and the notice said
//   kept the newer edit to "" ($0, was $0)
// Since SYNC-1 step 3 fetches on open, right after the purge, this is likely
// whenever a deleted transaction ages out on two devices.
//
// The owner's rules:
//   * two deletions, or two purges, of one transaction are identical, whatever
//     their times: never a conflict;
//   * the merge notice never describes a deleted or purged record.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mergeTransactions, purgeTransaction, DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";
import { buildMergeNoticeText, fetchAndMerge } from "./syncService";

const KEBAB: StoredTransaction = {
  id: "t-kebab", amount: 18.5, currency: "USD", bucket: "WANTS", category: "dining",
  description: "Kebab at Barbar", date: "2026-08-29", updatedAt: "2026-09-01T10:00:00.000Z",
} as StoredTransaction;
const deletedOn = (at: string, extra: Partial<StoredTransaction> = {}) => ({ ...KEBAB, ...extra, deletedAt: at, updatedAt: at });
// Deleted on 2026-09-01; each device purges on its first open past 30 days.
const DELETED = deletedOn("2026-09-01T10:00:00.000Z");
const purgedOnPhone = purgeTransaction(DELETED, new Date("2026-10-02T07:41:00.000Z"));
const purgedOnLaptop = purgeTransaction(DELETED, new Date("2026-10-03T19:12:00.000Z"));

describe("reproduction: two purges of one deleted transaction", () => {
  it("premise: the copies differ only in when each device purged", () => {
    const { purgedAt: a, ...restA } = purgedOnPhone;
    const { purgedAt: b, ...restB } = purgedOnLaptop;
    expect(a).not.toBe(b);
    expect(restA).toEqual(restB);
  });

  it("are not a conflict, from either side", () => {
    expect(mergeTransactions([purgedOnPhone], [purgedOnLaptop]).conflictsResolved).toBe(0);
    expect(mergeTransactions([purgedOnLaptop], [purgedOnPhone]).conflictsResolved).toBe(0);
  });

  it("draw no merge notice", () => {
    const r = mergeTransactions([purgedOnPhone], [purgedOnLaptop]);
    const details = r.conflicts.map((winner) => ({ winner, loser: winner === purgedOnPhone ? purgedOnLaptop : purgedOnPhone }));
    expect(buildMergeNoticeText(r.addedFromServer, details).text).toBe("");
  });
});

describe("two deletions or two purges are identical, whatever their times", () => {
  it("two deletions at different times: no conflict, and the same copy kept from either side", () => {
    const onPhone = deletedOn("2026-09-01T10:00:00.000Z");
    // The laptop corrected the amount before deleting it, later.
    const onLaptop = deletedOn("2026-09-02T21:30:00.000Z", { amount: 21 });
    const a = mergeTransactions([onPhone], [onLaptop]);
    const b = mergeTransactions([onLaptop], [onPhone]);
    expect(a.conflictsResolved).toBe(0);
    expect(b.conflictsResolved).toBe(0);
    expect(a.transactions).toEqual(b.transactions);
  });

  it("two purges: the same copy kept from either side", () => {
    expect(mergeTransactions([purgedOnPhone], [purgedOnLaptop]).transactions)
      .toEqual(mergeTransactions([purgedOnLaptop], [purgedOnPhone]).transactions);
  });

  it("unchanged: a purge still beats a deletion, and a deletion an active copy, with no conflict", () => {
    expect(mergeTransactions([DELETED], [purgedOnLaptop])).toMatchObject({ conflictsResolved: 0, transactions: [purgedOnLaptop] });
    expect(mergeTransactions([KEBAB], [DELETED])).toMatchObject({ conflictsResolved: 0, transactions: [DELETED] });
  });

  it("unchanged: two active copies edited differently are still a conflict", () => {
    const edited = { ...KEBAB, amount: 21, updatedAt: "2026-09-02T09:00:00.000Z" };
    expect(mergeTransactions([KEBAB], [edited]).conflictsResolved).toBe(1);
  });
});

describe("the merge notice never describes a deleted or purged record", () => {
  const live = { ...KEBAB, id: "t-bistro", description: "Bistro Margaux", amount: 46.8, updatedAt: "2026-10-06T19:00:00.000Z" };
  const older = { ...live, amount: 40, updatedAt: "2026-10-06T18:00:00.000Z" };

  it.each([
    ["a deleted winner", { winner: DELETED, loser: KEBAB }],
    ["a deleted loser", { winner: KEBAB, loser: DELETED }],
    ["two purged copies", { winner: purgedOnLaptop, loser: purgedOnPhone }],
  ])("%s: not described", (_label, detail) => {
    expect(buildMergeNoticeText(0, [detail])).toEqual({ text: "", showReviewLink: false });
  });

  it("beside a real conflict, only the real one is described", () => {
    expect(buildMergeNoticeText(0, [{ winner: purgedOnLaptop, loser: purgedOnPhone }, { winner: live, loser: older }]).text)
      .toBe('Merged with your other device — kept the newer edit to "Bistro Margaux" ($47, was $40).');
  });

  describe("end to end, from a fetch", () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    it("each device purged on its own: the fetch reports nothing", async () => {
      sessionStorage.setItem("essa_st_v1", "tok");
      const on = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
      const server = { ...DEFAULT_DATA, ...on, transactions: [purgedOnPhone] } as LocalFinancials;
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data: server, syncedAt: "2026-10-03T19:15:00.000Z", hasRecoveryCode: true }), { status: 200 })));
      const r = await fetchAndMerge("u1@example.com", () => ({ ...DEFAULT_DATA, ...on, transactions: [purgedOnLaptop] }) as LocalFinancials);
      if (!r.ok || r.skipped) throw new Error("expected a merge");
      expect(r.conflictDetails).toEqual([]);
      expect(buildMergeNoticeText(r.addedFromServer, r.conflictDetails, [], r.replacedCloses).text).toBe("");
    });
  });
});
