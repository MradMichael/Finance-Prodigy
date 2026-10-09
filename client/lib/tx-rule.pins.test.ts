// Item 7 (owner, session 8): transactions onto the fingerprint rule. These PIN
// today's outcomes for soft-delete, purge and revival before the rule exists,
// and must still hold after it: deletions and purges outrank a live copy
// (tombstoneRank), a revival wins only at a strictly later generation
// (deletedGen vs revivedKeys), two deletions or two purges are never a
// conflict (DI-12), and a key either device recorded as deleted is gone
// (deletedKeys). The rule only ever compares two copies of the same rank.
//
// Each case runs through mergeFinancials with no sync record (today's merge)
// and with one (the rule active), in both directions.
import { describe, it, expect } from "vitest";
import { mergeFinancials } from "./syncMerge";
import { seenOf, type SeenMap } from "./syncSeen";
import { purgeTransaction, DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const KEBAB = {
  id: "t-kebab", amount: 18.5, currency: "USD", bucket: "WANTS", category: "dining",
  description: "Kebab at Barbar", date: "2026-09-29", updatedAt: "2026-09-29T10:00:00.000Z",
} as StoredTransaction;
const edited = (t: StoredTransaction, at: string, extra: Partial<StoredTransaction> = {}) => ({ ...t, amount: 21, ...extra, updatedAt: at });
const deleted = (t: StoredTransaction, at: string, gen?: number) => ({ ...t, deletedAt: at, updatedAt: at, ...(gen !== undefined ? { deletedGen: gen } : {}) }) as StoredTransaction;
const copy = (txs: StoredTransaction[], extra: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, transactions: txs, ...extra }) as LocalFinancials;

/** Today's merge and the rule's, both ways round; every one must keep `expected` and report no conflict unless `conflict`. */
function pinned(local: LocalFinancials, server: LocalFinancials, lastSync: LocalFinancials, expected: (StoredTransaction | undefined), conflict = false) {
  const seen: SeenMap = seenOf(lastSync);
  for (const [a, b] of [[local, server], [server, local]] as const) {
    for (const record of [null, seen]) {
      const r = mergeFinancials(a, b, NOW, record);
      const got = r.data.transactions.find((t) => t.id === KEBAB.id);
      expect(got, `record=${record ? "yes" : "no"}`).toEqual(expected);
      expect(r.transactions.conflictsResolved, `record=${record ? "yes" : "no"}`).toBe(conflict ? 1 : 0);
    }
  }
}

describe("pinned: deletion and purge outrank a live copy", () => {
  it("a deletion beats an edit made on the other device before it saw the deletion", () => {
    const del = deleted(KEBAB, "2026-10-01T10:00:00.000Z");
    pinned(copy([del]), copy([edited(KEBAB, "2026-10-02T10:00:00.000Z")]), copy([KEBAB]), del);
  });
  it("a deletion on one device, nothing on the other: the deletion", () => {
    const del = deleted(KEBAB, "2026-10-01T10:00:00.000Z");
    pinned(copy([del]), copy([KEBAB]), copy([KEBAB]), del);
  });
  it("a purge beats a deletion", () => {
    const del = deleted(KEBAB, "2026-09-01T10:00:00.000Z");
    const purged = purgeTransaction(del, new Date("2026-10-02T07:41:00.000Z"));
    pinned(copy([purged]), copy([del]), copy([del]), purged);
  });
  it("a purge on one device only is taken", () => {
    const del = deleted(KEBAB, "2026-09-01T10:00:00.000Z");
    const purged = purgeTransaction(del, new Date("2026-10-02T07:41:00.000Z"));
    pinned(copy([purged]), copy([del]), copy([purged]), purged);
  });
});

describe("pinned: two deletions or two purges are never a conflict (DI-12)", () => {
  it("two deletions at different times: the same copy kept from either side, no conflict", () => {
    const onPhone = deleted(KEBAB, "2026-10-01T10:00:00.000Z");
    const onLaptop = deleted({ ...KEBAB, amount: 21 }, "2026-10-02T21:30:00.000Z");
    const today = mergeFinancials(copy([onPhone]), copy([onLaptop]), NOW, null).data.transactions[0];
    pinned(copy([onPhone]), copy([onLaptop]), copy([KEBAB]), today);
  });
  it("two deleted copies are still picked by time, not by which side changed since the last sync", () => {
    const mine = deleted(KEBAB, "2026-10-02T21:30:00.000Z");                 // what this device last synced
    const theirs = deleted({ ...KEBAB, amount: 21 }, "2026-10-01T10:00:00.000Z"); // changed since, by a slow clock
    pinned(copy([mine]), copy([theirs]), copy([mine]), mine);
  });
  it("two purges: the same copy kept, no conflict", () => {
    const del = deleted(KEBAB, "2026-09-01T10:00:00.000Z");
    const a = purgeTransaction(del, new Date("2026-10-02T07:41:00.000Z"));
    const b = purgeTransaction(del, new Date("2026-10-03T19:12:00.000Z"));
    const today = mergeFinancials(copy([a]), copy([b]), NOW, null).data.transactions[0];
    pinned(copy([a]), copy([b]), copy([del]), today);
  });
});

describe("pinned: a revival wins only at a strictly later generation (DI-13, DI-14)", () => {
  it("a restore's revival beats a deletion from an earlier generation", () => {
    const del = deleted(KEBAB, "2026-10-01T10:00:00.000Z", 1);
    const revived = copy([KEBAB], { revivedKeys: { transactions: { [KEBAB.id]: 2 } } });
    pinned(revived, copy([del]), copy([del]), KEBAB);
  });
  it("a deletion made at the revival's generation beats it", () => {
    const del = deleted(KEBAB, "2026-10-03T10:00:00.000Z", 2);
    const revived = copy([KEBAB], { revivedKeys: { transactions: { [KEBAB.id]: 2 } } });
    pinned(revived, copy([del]), copy([KEBAB]), del);
  });
  it("Recently deleted → Restore (a later generation) beats the stale deleted copy on the other device", () => {
    const del = deleted(KEBAB, "2026-10-01T10:00:00.000Z");
    const restored = { ...KEBAB, updatedAt: "2026-10-04T10:00:00.000Z" };
    const here = copy([restored], { revivedKeys: { transactions: { [KEBAB.id]: 1 } } });
    pinned(here, copy([del]), copy([del]), restored);
  });
});

describe("pinned: a key recorded as deleted is gone from the merge (deletedKeys)", () => {
  it("a transaction whose key either device recorded as deleted is dropped from both", () => {
    const here = copy([KEBAB], { deletedKeys: { transactions: [{ key: KEBAB.id, deletedAt: "2026-10-01T10:00:00.000Z" }] } });
    pinned(here, copy([edited(KEBAB, "2026-10-02T10:00:00.000Z")]), copy([KEBAB]), undefined);
  });
});

describe("pinned: two live copies both edited are still a conflict, the later edit kept", () => {
  it("the later edit wins and is reported, with or without a record", () => {
    const later = edited(KEBAB, "2026-10-02T10:00:00.000Z", { amount: 25 });
    pinned(copy([edited(KEBAB, "2026-10-01T10:00:00.000Z")]), copy([later]), copy([KEBAB]), later, true);
  });
});
