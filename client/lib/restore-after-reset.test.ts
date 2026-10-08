// DI-13 follow-up (owner, session 3): a restore after a reset must win, without
// clocks. The reset records a deletion for every item it clears; restoring an
// export put the items back on this device, but the next merge unioned the
// reset's deletion records back in and dropped them again.
//
// Generations (plan (a), FIX_PLANS.md): a deletion record carries the restore
// generation it was written in (absent = 0). A restore starts the next
// generation and marks every key in the file that has a record as REVIVED at
// it. Per key, the later generation wins; at the same generation a deletion
// beats a revival. No time is compared, so device clocks don't matter.
import { describe, it, expect, vi } from "vitest";
import { resetFinancials, recordDeletion, softDelete, purgeTransaction, undoCloseEffects, uid, DEFAULT_DATA, type LocalFinancials, type StoredTransaction, type DeletedKeys, type PeriodClose } from "./localData";
import { mergeFinancials, restoreFromExport } from "./syncMerge";
import { fetchAndMerge } from "./syncService";

const T0 = new Date("2026-10-07T18:00:00.000Z");
const tx = (id: string): StoredTransaction => ({ id, amount: 46.8, currency: "USD", bucket: "WANTS", category: "dining", description: id, date: "2026-10-01", updatedAt: "2026-10-01T12:00:00.000Z" } as StoredTransaction);
const wish = (id: string, name: string) => ({ id, name, emoji: "✨", price: 64.2, currency: "USD", priority: "medium", createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" });
const ON = { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" };

/** What both devices held, and what the export file holds. */
const EXPORT = {
  ...DEFAULT_DATA, income: 3150.75, syncChoice: ON,
  transactions: [tx("t-bistro"), tx("t-kettle")],
  wishlist: [wish("w1", "Quartz lamp")],
  goals: [{ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 300, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" }],
} as unknown as LocalFinancials;
/** The same account after the export: one more transaction, made after the file was saved. */
const LATER = { ...EXPORT, transactions: [...EXPORT.transactions, tx("t-later")] } as LocalFinancials;

// What merges across devices. Goals are one of the five lists that still keep
// each device's own copy until SYNC-1 step 4, so they are checked separately.
const ids = (d: LocalFinancials) => ({
  transactions: d.transactions.map((t) => t.id).sort(),
  wishlist: (d.wishlist ?? []).map((w) => w.id),
});
const merge = (a: LocalFinancials, b: LocalFinancials) => mergeFinancials(a, b, T0).data;

describe("a restore after a reset wins", () => {
  it("across two devices: the other device gets the restored items back", () => {
    const phoneReset = resetFinancials(LATER, T0);
    const laptop = merge(LATER, phoneReset); // the laptop picks up the reset
    expect(ids(laptop)).toEqual({ transactions: [], wishlist: [] }); // premise: the reset reached it
    const phone = restoreFromExport(phoneReset, EXPORT);
    expect(ids(merge(laptop, phone))).toEqual(ids(EXPORT));
    expect(ids(merge(phone, laptop))).toEqual(ids(EXPORT));
  });

  it("an item the file doesn't hold stays deleted, even from a device that never saw the reset", () => {
    const phone = restoreFromExport(resetFinancials(LATER, T0), EXPORT);
    const staleLaptop = LATER; // still holds t-later, and no deletion records
    expect(ids(merge(staleLaptop, phone)).transactions).toEqual(["t-bistro", "t-kettle"]);
    expect(ids(merge(phone, staleLaptop)).transactions).toEqual(["t-bistro", "t-kettle"]);
  });

  it("doesn't depend on clocks: the reset's records can carry any time", () => {
    const future = new Date("2031-01-01T00:00:00.000Z"); // the resetting device's clock far ahead
    const phone = restoreFromExport(resetFinancials(LATER, future), EXPORT);
    const laptop = merge(LATER, resetFinancials(LATER, future));
    expect(ids(merge(laptop, phone))).toEqual(ids(EXPORT));
  });

  it("a list that keeps this device's copy (goals): the restoring device keeps what it restored", () => {
    const phone = restoreFromExport(resetFinancials(LATER, T0), EXPORT);
    const laptop = merge(LATER, resetFinancials(LATER, T0)); // holds the reset's record for g1
    expect(merge(phone, laptop).goals.map((g) => g.id)).toEqual(["g1"]);
  });

  it("is the same whichever side merges (records and items)", () => {
    const phone = restoreFromExport(resetFinancials(LATER, T0), EXPORT);
    const laptop = merge(LATER, resetFinancials(LATER, T0));
    const a = merge(laptop, phone), b = merge(phone, laptop);
    expect(ids(a)).toEqual(ids(b));
    const norm = (d: DeletedKeys | undefined) => JSON.stringify(Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, [...(v ?? [])].sort((x, y) => x.key.localeCompare(y.key))])));
    expect(norm(a.deletedKeys)).toBe(norm(b.deletedKeys));
  });
});

describe("deletions after the restore", () => {
  it("a deletion made after seeing the restore still applies, from either side", () => {
    const phone = restoreFromExport(resetFinancials(LATER, T0), EXPORT);
    const laptop = merge(merge(LATER, resetFinancials(LATER, T0)), phone); // has seen the restore
    const phoneDeletes = { ...phone, wishlist: [], deletedKeys: recordDeletion(phone, "wishlist", "w1", T0) };
    expect(ids(merge(laptop, phoneDeletes)).wishlist).toEqual([]);
    expect(ids(merge(phoneDeletes, laptop)).wishlist).toEqual([]);
    const laptopDeletes = { ...laptop, wishlist: [], deletedKeys: recordDeletion(laptop, "wishlist", "w1", T0) };
    expect(ids(merge(phone, laptopDeletes)).wishlist).toEqual([]);
  });

  it("deleting a restored key records a deletion (it isn't skipped as already recorded)", () => {
    const phone = restoreFromExport(resetFinancials(LATER, T0), EXPORT);
    const rec = recordDeletion(phone, "wishlist", "w1", T0).wishlist!.find((t) => t.key === "w1")!;
    expect(rec.gen).toBe(1); // replaces the reset's generation-0 record, at the restore's generation
    expect(rec.deletedAt).toBe(T0.toISOString());
  });

  it("a deletion made without having seen the restore loses to it", () => {
    const phone = restoreFromExport(resetFinancials(LATER, T0), EXPORT);
    const laptop = { ...LATER, wishlist: [], deletedKeys: recordDeletion(LATER, "wishlist", "w1", new Date("2031-01-01T00:00:00.000Z")) };
    expect(ids(merge(laptop, phone)).wishlist).toEqual(["w1"]);
  });

  it("resetting again undoes the restore", () => {
    const phone = resetFinancials(restoreFromExport(resetFinancials(LATER, T0), EXPORT), T0);
    const laptop = merge(LATER, restoreFromExport(resetFinancials(LATER, T0), EXPORT));
    expect(ids(merge(laptop, phone))).toEqual({ transactions: [], wishlist: [] });
  });
});

// Session 4 (owner): a restore revives EVERY key the file holds, not only keys
// with a known deletion record -- so a deletion this device never synced
// (another device deleted X; this device still had X) loses to the restore too.
// Revivals live in their own field, revivedKeys, so code that predates them
// never reads one as a deletion.
describe("a deletion this device never synced", () => {
  it("a wishlist item deleted on the other device survives on both after the restore", () => {
    const laptop = { ...EXPORT, wishlist: [], deletedKeys: recordDeletion(EXPORT, "wishlist", "w1", T0) } as LocalFinancials;
    const phone = restoreFromExport(EXPORT, EXPORT); // the phone still had w1 and never saw that deletion
    expect(ids(merge(laptop, phone)).wishlist).toEqual(["w1"]);
    expect(ids(merge(phone, laptop)).wishlist).toEqual(["w1"]);
  });

  it("a transaction deleted (or purged) on the other device survives on both after the restore", () => {
    for (const gone of [
      { ...tx("t-bistro"), deletedAt: "2026-10-05T10:00:00.000Z", updatedAt: "2026-10-05T10:00:00.000Z" },
      { id: "t-bistro", amount: 0, currency: "USD", bucket: "WANTS", description: "", date: "2026-10-01", deletedAt: "2026-09-01T10:00:00.000Z", purgedAt: "2026-10-02T10:00:00.000Z" },
    ] as StoredTransaction[]) {
      const laptop = { ...EXPORT, transactions: [gone, tx("t-kettle")] } as LocalFinancials;
      const phone = restoreFromExport(EXPORT, EXPORT);
      for (const d of [merge(laptop, phone), merge(phone, laptop)]) {
        const t = d.transactions.find((x) => x.id === "t-bistro")!;
        expect(t.deletedAt).toBeUndefined();
        expect(t.purgedAt).toBeUndefined();
        expect(t.amount).toBe(46.8);
      }
    }
  });

  it("a transaction deleted AFTER seeing the restore stays deleted, from either side", () => {
    const phone = restoreFromExport(EXPORT, EXPORT);
    const laptop = merge(EXPORT, phone); // has seen the restore
    const at = "2026-10-08T09:00:00.000Z";
    const laptopDeletes = { ...laptop, transactions: laptop.transactions.map((t) => (t.id === "t-bistro" ? softDelete(laptop, t, at) : t)) };
    for (const d of [merge(laptopDeletes, phone), merge(phone, laptopDeletes)]) {
      expect(d.transactions.find((x) => x.id === "t-bistro")?.deletedAt).toBe(at);
    }
  });
});

describe("two restores", () => {
  it("the later restore's revival is the one that counts, from either side", () => {
    // Restore 1 on the phone; the laptop sees it, then deletes w1 (generation 1).
    const phone1 = restoreFromExport(EXPORT, EXPORT);
    const laptop = merge(EXPORT, phone1);
    const laptopDeleted = { ...laptop, wishlist: [], deletedKeys: recordDeletion(laptop, "wishlist", "w1", T0) };
    // Restore 2 on the phone, which never saw that deletion: generation 2 revives w1 again.
    const phone2 = restoreFromExport(phone1, EXPORT);
    expect(phone2.revivedKeys?.wishlist).toEqual({ w1: 2 });
    expect(ids(merge(laptopDeleted, phone2)).wishlist).toEqual(["w1"]);
    expect(ids(merge(phone2, laptopDeleted)).wishlist).toEqual(["w1"]);
  });
});

describe("what a restore does not revive", () => {
  it("a transaction the file itself holds as deleted stays deleted (an older export)", () => {
    const gone = { ...tx("t-bistro"), deletedAt: "2026-10-02T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z" } as StoredTransaction;
    const file = { ...EXPORT, transactions: [gone, tx("t-kettle")] } as LocalFinancials;
    const phone = restoreFromExport(EXPORT, file);
    expect(phone.revivedKeys?.transactions?.["t-bistro"]).toBeUndefined();
    const laptop = EXPORT; // still holds t-bistro live
    for (const d of [merge(laptop, phone), merge(phone, laptop)]) {
      expect(d.transactions.find((x) => x.id === "t-bistro")?.deletedAt).toBe("2026-10-02T10:00:00.000Z");
    }
  });
});

describe("the close-undo deletions", () => {
  it("a reopen's soft-deletes carry the current generation too", () => {
    // A close whose emergency-fund correction row is still the latest: undoing
    // the close soft-deletes that row.
    const close = { cycleKey: "2026-09", rangeStart: "2026-08-27", rangeEnd: "2026-09-26", startDayAtClose: 27, closedAt: "2026-09-27T08:00:00.000Z",
      accounts: [], emergencyFund: { transactionId: "t-adj" } } as unknown as PeriodClose;
    const adj = { id: "t-adj", amount: 25, currency: "USD", bucket: "SAVINGS", description: "Emergency fund correction", date: "2026-09-26", createdAt: "2026-09-27T08:00:00.000Z" } as StoredTransaction;
    const data = { ...EXPORT, transactions: [adj], periodCloses: [close], revivedKeys: { transactions: { "t-adj": 3 } } } as unknown as LocalFinancials;
    const t = undoCloseEffects(data, close, "2026-10-08T09:00:00.000Z").transactions.find((x) => x.id === "t-adj")!;
    expect(t.deletedAt).toBe("2026-10-08T09:00:00.000Z"); // premise: the undo removed it
    expect(t.deletedGen).toBe(3);
  });
});

describe("the upload after a restore", () => {
  it("counts the revivals as something the server lacks", async () => {
    sessionStorage.setItem("essa_st_v1", "tok");
    const server = { ...EXPORT };
    const phone = restoreFromExport(EXPORT, EXPORT); // same items as the server; only the revivals differ
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data: server, syncedAt: "2026-10-08T09:00:00.000Z", hasRecoveryCode: true }), { status: 200 })));
    try {
      const r = await fetchAndMerge("u1@example.com", () => phone);
      if (!r.ok || r.skipped) throw new Error("expected a merge");
      expect(r.serverBehind).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("the 30-day purge", () => {
  it("keeps the deletion's generation, so a purge doesn't let an older restore win", () => {
    const phone = restoreFromExport(EXPORT, EXPORT);
    const laptop = merge(EXPORT, phone); // has seen the restore
    const at = "2026-10-08T09:00:00.000Z";
    const purged = purgeTransaction(softDelete(laptop, laptop.transactions.find((t) => t.id === "t-bistro")!, at), new Date("2026-11-08T09:00:00.000Z"));
    expect(purged.deletedGen).toBe(1);
    const laptopPurged = { ...laptop, transactions: laptop.transactions.map((t) => (t.id === "t-bistro" ? purged : t)) };
    for (const d of [merge(laptopPurged, phone), merge(phone, laptopPurged)]) {
      expect(d.transactions.find((x) => x.id === "t-bistro")?.purgedAt).toBe("2026-11-08T09:00:00.000Z");
    }
  });
});

describe("the records", () => {
  it("records written before generations existed count as generation 0", () => {
    const old: DeletedKeys = { wishlist: [{ key: "w1", deletedAt: "2026-09-01T09:00:00.000Z" }] };
    const phone = restoreFromExport({ ...DEFAULT_DATA, deletedKeys: old } as LocalFinancials, EXPORT);
    expect(phone.deletedKeys?.wishlist).toEqual(old.wishlist); // the deletion record itself is untouched
    expect(phone.revivedKeys?.wishlist).toEqual({ w1: 1 });
    const other = { ...EXPORT, wishlist: [], deletedKeys: old } as LocalFinancials;
    expect(ids(merge(other, phone)).wishlist).toEqual(["w1"]);
  });

  it("the restore keeps the file's data and settings, and revives every live key it holds", () => {
    const phone = restoreFromExport(resetFinancials(LATER, T0), EXPORT);
    expect(ids(phone)).toEqual(ids(EXPORT));
    expect(phone.income).toBe(3150.75);
    expect(phone.revivedKeys?.transactions).toEqual({ "t-bistro": 1, "t-kettle": 1 });
    expect(phone.revivedKeys?.wishlist).toEqual({ w1: 1 });
    expect(phone.revivedKeys?.goals).toEqual({ g1: 1 });
    // The reset's record for what the file lacks is untouched, and in force.
    expect(phone.deletedKeys?.transactions?.find((t) => t.key === "t-later")).toBeTruthy();
    expect(phone.revivedKeys?.transactions?.["t-later"]).toBeUndefined();
  });

  it("no revival is written into the deletion records (older code would read it as a deletion)", () => {
    const phone = restoreFromExport(resetFinancials(LATER, T0), EXPORT);
    for (const list of Object.values(phone.deletedKeys ?? {})) for (const t of list ?? []) expect(t).not.toHaveProperty("revived");
  });

  it("costs one short entry per item the file holds (measured)", () => {
    const n = 2000;
    const big = { ...EXPORT, transactions: Array.from({ length: n }, () => tx(uid())) } as LocalFinancials;
    const phone = restoreFromExport(big, big);
    const bytes = JSON.stringify(phone.revivedKeys?.transactions).length;
    process.stdout.write(`[size] ${n} transactions -> revivedKeys.transactions = ${bytes} bytes (${(bytes / n).toFixed(1)} per item)\n`);
    expect(bytes / n).toBeLessThan(40);
  });
});
