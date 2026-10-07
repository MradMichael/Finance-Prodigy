// The transaction merge's tie-break (owner, 2026-10-07; recorded as a latent
// defect during SYNC-1 step 2).
//
// resolveTransactionConflict compared edit times with `timeA >= timeB ? a : b`,
// so two copies with the SAME edit time (or none) and different content went
// to whichever was passed first -- the merging device's own copy. Two devices
// merging the same pair kept different versions. Its comment, and
// mergeTransactions', claimed order-independence; the symmetry test never
// paired two equal times, so it passed anyway.
//
// It also judged "same content" with plain JSON.stringify, so one record
// holding its keys in a different order (a migration appends a field; a
// spread rebuilds a record) counted as a conflict and drew a merge notice.
//
// Now both use step 2's rules (lib/canonical.ts): content compared in key
// order, and an equal-time tie goes to the larger canonical text, the same
// pick from either side.
import { describe, it, expect } from "vitest";
import { mergeTransactions, type StoredTransaction } from "./localData";

const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: "t-tawlet", amount: 50, currency: "USD", bucket: "WANTS", category: "dining", description: "Lunch at Tawlet", date: "2026-10-03", ...o }) as StoredTransaction;

describe("two copies with the same edit time and different content", () => {
  const AT = "2026-10-03T13:20:00.000Z";
  const phone = tx({ amount: 50, updatedAt: AT });
  const laptop = tx({ amount: 75, updatedAt: AT });

  it("the same copy wins whichever device merges", () => {
    const fromPhone = mergeTransactions([phone], [laptop]);
    const fromLaptop = mergeTransactions([laptop], [phone]);
    expect(fromPhone.transactions).toEqual(fromLaptop.transactions);
  });

  // Step 2's tie-break: the larger canonical text. {"amount":75,...} sorts
  // above {"amount":50,...}, so $75 stands from both sides.
  it("it's the one step 2's tie-break picks, and it's reported as a conflict both ways", () => {
    for (const r of [mergeTransactions([phone], [laptop]), mergeTransactions([laptop], [phone])]) {
      expect(r.transactions[0].amount).toBe(75);
      expect(r.conflictsResolved).toBe(1);
      expect(r.conflicts[0].amount).toBe(75);
    }
  });

  it("the same with no edit time on either copy", () => {
    const a = tx({ amount: 50 }), b = tx({ amount: 75 });
    expect(mergeTransactions([a], [b]).transactions).toEqual(mergeTransactions([b], [a]).transactions);
    expect(mergeTransactions([a], [b]).transactions[0].amount).toBe(75);
  });
});

describe("one record, keys in a different order", () => {
  it("is not a conflict, from either side", () => {
    const a = tx({ updatedAt: "2026-10-03T13:20:00.000Z", lbpRateAtEntry: undefined });
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as StoredTransaction;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(reordered)); // premise: plain JSON sees a difference
    expect(mergeTransactions([a], [reordered]).conflictsResolved).toBe(0);
    expect(mergeTransactions([reordered], [a]).conflictsResolved).toBe(0);
  });
});

describe("unchanged", () => {
  it("a later edit time still wins, either way round", () => {
    const older = tx({ amount: 50, updatedAt: "2026-10-03T13:20:00.000Z" });
    const newer = tx({ amount: 46.8, updatedAt: "2026-10-03T13:25:00.000Z" });
    expect(mergeTransactions([older], [newer]).transactions[0].amount).toBe(46.8);
    expect(mergeTransactions([newer], [older]).transactions[0].amount).toBe(46.8);
  });

  it("a deletion still beats an active copy whatever the times", () => {
    const deleted = tx({ deletedAt: "2026-10-03T13:00:00.000Z", updatedAt: "2026-10-03T13:00:00.000Z" });
    const edited = tx({ amount: 75, updatedAt: "2026-10-03T14:00:00.000Z" });
    expect(mergeTransactions([edited], [deleted]).transactions[0].deletedAt).toBe("2026-10-03T13:00:00.000Z");
  });
});
