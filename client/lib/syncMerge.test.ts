// SYNC-1 step 2 (DI-08, 2026-10-06): one merge engine for everything a
// person enters by hand that can be lost to another device's sync.
//
// Stage 1 reproduced the loss: a merge kept the merging device's wishlist and
// discarded the server's, so "Cobalt kettle" ($41.60) ended up on no device.
// Phase 2.7 merged transactions only, for one stated reason: the other lists
// had no delete-tombstones, so a union would bring back what a device had
// deleted. This step adds tombstones (a registry of deleted keys, so screens
// still see plain lists) and merges:
//   * the wishlist, custom categories and category rules: by key, last edit
//     wins, a deletion beats any copy;
//   * tracked balances: by id, and when both devices checked in, the LATER
//     check-in wins (Phase 3's "never move a baseline backwards", across
//     devices);
//   * period closes: record by record. A reopen beats a live copy. Two closes
//     of one cycle: the earlier stands, and the later is undone the way a
//     reopen undoes it, keeping the note its owner wrote (owner, 2026-10-06).
// Settings stay "this device wins" (owner, 2026-10-06); the divergence notice
// names them (syncService).
//
// Every case is checked in both directions: which device is "local" must
// never change what wins.
import { describe, it, expect } from "vitest";
import { mergeFinancials, mergeByKey, type Tombstone } from "./syncMerge";
import {
  DEFAULT_DATA, buildPeriodClose, reanchorTrackedBalance, buildEfAdjustmentTx, canReopen, acknowledgementFor,
  type LocalFinancials, type WishlistItem, type TrackedBalance, type PeriodClose,
} from "./localData";
import { cycleCloseInstant, type CycleKey } from "./period";

const NOW = new Date("2026-10-06T19:12:00.000Z");
const START_DAY = 27;
const CYCLE = "2026-08" as CycleKey; // 27 Aug – 26 Sep at payday 27
const ANCHOR = cycleCloseInstant(CYCLE, START_DAY);

const wish = (id: string, name: string, price: number, updatedAt: string, extra: Partial<WishlistItem> = {}): WishlistItem => ({
  id, name, emoji: "✨", price, currency: "USD", priority: "medium", createdAt: "2026-10-01T09:00:00.000Z", updatedAt, ...extra,
});
const base = (extra: Partial<LocalFinancials> = {}): LocalFinancials =>
  ({ ...DEFAULT_DATA, income: 3150.75, cycleStartDay: START_DAY, ...extra }) as LocalFinancials;
const names = (d: LocalFinancials) => (d.wishlist ?? []).map((w) => w.name).sort();
const both = (a: LocalFinancials, b: LocalFinancials) => [mergeFinancials(a, b, NOW), mergeFinancials(b, a, NOW)];

const CASH: TrackedBalance = {
  id: "tb-cash", name: "Wallet cash", paymentMethod: "cash", startingBalance: 412.35, startingDate: "2026-08-01", currency: "USD",
};

/** Closes CYCLE on one device exactly as BalanceCheckScreen does: record, re-anchor, and (optionally) an EF correction row. */
function closeOn(d: LocalFinancials, closedAt: string, counted: number, opts: { note?: string; efDelta?: number } = {}): LocalFinancials {
  const tb = (d.trackedBalances ?? []).find((t) => t.id === CASH.id)!;
  const ef = opts.efDelta != null ? buildEfAdjustmentTx(opts.efDelta) : null;
  const ef2 = ef ? { ...ef, createdAt: closedAt, updatedAt: closedAt } : null;
  const record = buildPeriodClose({
    cycleKey: CYCLE, startDay: START_DAY, closedAt: new Date(closedAt), lbpRate: 89_500,
    accounts: [{
      tb, actual: counted, actualUSD: counted, expectedAtClose: tb.startingBalance, anchoredAt: ANCHOR,
      ...(opts.note ? { acknowledgement: { note: opts.note, acknowledgedAt: closedAt, discrepancy: counted - tb.startingBalance, startingAt: ANCHOR } } : {}),
    }],
    ...(ef2 ? { emergencyFund: { expectedUSD: 1200, countedUSD: 1200 + opts.efDelta!, deltaUSD: opts.efDelta!, transactionId: ef2.id } } : {}),
  });
  return {
    ...d,
    trackedBalances: (d.trackedBalances ?? []).map((t) => (t.id === tb.id ? reanchorTrackedBalance(t, counted, tb.startingBalance, 89_500, ANCHOR) : t)),
    transactions: ef2 ? [ef2, ...(d.transactions ?? [])] : d.transactions,
    periodCloses: [...(d.periodCloses ?? []), record],
  };
}

describe("the wishlist merges item by item", () => {
  it("Stage 1's run: the phone's [lamp, easel, tote] and the laptop's [lamp, kettle] keep all four", () => {
    const lamp = wish("w1", "Quartz lamp", 64.2, "2026-10-06T17:18:40.000Z");
    const phone = base({ wishlist: [lamp, wish("w2", "Velvet easel", 118.75, "2026-10-06T17:19:05.000Z"), wish("w4", "Linen tote", 19.9, "2026-10-06T17:20:30.000Z")] });
    const laptop = base({ wishlist: [lamp, wish("w3", "Cobalt kettle", 41.6, "2026-10-06T17:19:50.000Z")] });
    for (const r of both(phone, laptop)) expect(names(r.data)).toEqual(["Cobalt kettle", "Linen tote", "Quartz lamp", "Velvet easel"]);
  });

  it("the same item edited on both: the later edit wins, from either side", () => {
    const early = wish("w1", "Quartz lamp", 64.2, "2026-10-06T17:00:00.000Z");
    const later = wish("w1", "Quartz lamp", 64.2, "2026-10-06T18:00:00.000Z", { boughtAt: "2026-10-06T18:00:00.000Z" });
    for (const r of both(base({ wishlist: [early] }), base({ wishlist: [later] }))) {
      expect(r.data.wishlist).toEqual([later]);
    }
  });

  it("a deletion beats the other device's copy, even one edited after the deletion", () => {
    const deleted: Tombstone = { key: "w3", deletedAt: "2026-10-06T17:30:00.000Z" };
    const laptop = base({ wishlist: [], deletedKeys: { wishlist: [deleted] } });
    const phone = base({ wishlist: [wish("w3", "Cobalt kettle", 41.6, "2026-10-06T17:45:00.000Z")] });
    for (const r of both(laptop, phone)) {
      expect(names(r.data)).toEqual([]);
      expect(r.data.deletedKeys?.wishlist).toEqual([deleted]);
    }
  });

  it("two copies with the same edit time but different content resolve the same way from either side", () => {
    const a = wish("w1", "Quartz lamp", 64.2, "2026-10-06T17:00:00.000Z");
    const b = wish("w1", "Quartz lamp", 66.4, "2026-10-06T17:00:00.000Z");
    const [r1, r2] = both(base({ wishlist: [a] }), base({ wishlist: [b] }));
    expect(r1.data.wishlist).toEqual(r2.data.wishlist);
  });

  it("an item with no edit time (made before this change) loses to an edited copy", () => {
    const { updatedAt: _u, ...legacy } = wish("w1", "Quartz lamp", 64.2, "x");
    const edited = wish("w1", "Quartz lamp", 64.2, "2026-10-06T17:00:00.000Z", { priority: "high" });
    for (const r of both(base({ wishlist: [legacy as WishlistItem] }), base({ wishlist: [edited] }))) expect(r.data.wishlist).toEqual([edited]);
  });
});

describe("custom categories and category rules merge the same way", () => {
  it("categories, keyed by value: both devices' additions survive, a deletion beats a copy", () => {
    const pharmacy = { value: "pharmacy", label: "Pharmacy", icon: "💊", updatedAt: "2026-10-05T10:00:00.000Z" };
    const fuel = { value: "fuel", label: "Fuel", icon: "⛽", updatedAt: "2026-10-05T11:00:00.000Z" };
    const gym = { value: "gym", label: "Gym", icon: "🏋", updatedAt: "2026-10-05T12:00:00.000Z" };
    const a = base({ customCategories: [pharmacy, fuel], deletedKeys: { customCategories: [{ key: "gym", deletedAt: "2026-10-05T13:00:00.000Z" }] } });
    const b = base({ customCategories: [pharmacy, gym] });
    for (const r of both(a, b)) expect((r.data.customCategories ?? []).map((c) => c.value).sort()).toEqual(["fuel", "pharmacy"]);
  });

  it("rules, keyed by id: a renamed keyword's later edit wins", () => {
    const older = { id: "r1", keyword: "Spinneys", category: "groceries", updatedAt: "2026-10-05T10:00:00.000Z" };
    const newer = { id: "r1", keyword: "Spinneys Achrafieh", category: "groceries", updatedAt: "2026-10-05T14:00:00.000Z" };
    for (const r of both(base({ categoryRules: [older] }), base({ categoryRules: [newer] }))) expect(r.data.categoryRules).toEqual([newer]);
  });
});

describe("tracked balances: the later check-in wins", () => {
  it("whichever device checked in later wins, from either side", () => {
    const early = reanchorTrackedBalance(CASH, 405.1, 412.35, 89_500, "2026-10-01T10:00:00.000Z");
    const later = reanchorTrackedBalance(CASH, 399.8, 405.1, 89_500, "2026-10-03T08:00:00.000Z");
    for (const r of both(base({ trackedBalances: [early] }), base({ trackedBalances: [later] }))) {
      expect(r.data.trackedBalances).toEqual([later]);
    }
  });

  it("a balance removed on one device stays removed", () => {
    const a = base({ trackedBalances: [], deletedKeys: { trackedBalances: [{ key: CASH.id, deletedAt: "2026-10-04T09:00:00.000Z" }] } });
    for (const r of both(a, base({ trackedBalances: [CASH] }))) expect(r.data.trackedBalances).toEqual([]);
  });
});

describe("period closes merge record by record", () => {
  it("a close made on the phone survives the laptop's sync, and brings its anchor", () => {
    const phone = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T08:00:00.000Z", 398.6);
    const laptop = base({ trackedBalances: [CASH] });
    for (const r of both(phone, laptop)) {
      expect(r.data.periodCloses).toHaveLength(1);
      expect(r.data.trackedBalances?.[0].startingBalance).toBe(398.6);
      expect(r.data.trackedBalances?.[0].startingAt).toBe(ANCHOR);
    }
  });

  it("a reopen on one device beats the live copy on the other, and the other's anchor is undone too", () => {
    const closed = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T08:00:00.000Z", 398.6);
    const reopenedAt = "2026-09-28T07:15:00.000Z";
    // The phone reopened: close marked, anchor restored to before the close.
    const phone: LocalFinancials = { ...closed, trackedBalances: [CASH], periodCloses: closed.periodCloses!.map((c) => ({ ...c, reopenedAt })) };
    // The laptop still holds the live close and its anchor.
    for (const r of both(phone, closed)) {
      expect(r.data.periodCloses?.[0].reopenedAt).toBe(reopenedAt);
      expect(r.data.trackedBalances).toEqual([CASH]);
    }
  });

  it("two closes of one cycle: the earlier stands, the later is undone like a reopen, and its note is kept", () => {
    const note = "Cash spent at the Saturday market, not logged";
    const phone = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T08:00:00.000Z", 398.6);
    const laptop = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T09:30:00.000Z", 401.15, { note });
    for (const r of both(phone, laptop)) {
      const closes = r.data.periodCloses ?? [];
      expect(closes).toHaveLength(2);
      const standing = closes.find((c) => c.closedAt === "2026-09-27T08:00:00.000Z")!;
      const later = closes.find((c) => c.closedAt === "2026-09-27T09:30:00.000Z")!;
      expect(standing.reopenedAt).toBeUndefined();
      expect(standing.supersededAt).toBeUndefined();
      expect(later.supersededAt).toBe(NOW.toISOString());
      // Undone the way a reopen undoes it -- and so older app versions, which
      // know only reopenedAt, see it as not in force too (rollback safety).
      expect(later.reopenedAt).toBe(NOW.toISOString());
      // The note the owner wrote stays in the record.
      expect(later.accounts[0].acknowledgement?.note).toBe(note);
      // The standing close's anchor is the one in force.
      expect(r.data.trackedBalances?.[0].startingBalance).toBe(398.6);
    }
  });

  it("the device whose close was replaced is told which close stands", () => {
    const phone = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T08:00:00.000Z", 398.6);
    const laptop = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T09:30:00.000Z", 401.15);
    const asLaptop = mergeFinancials(laptop, phone, NOW);
    expect(asLaptop.supersededFromLocal.map((s) => [s.superseded.closedAt, s.standing.closedAt])).toEqual([["2026-09-27T09:30:00.000Z", "2026-09-27T08:00:00.000Z"]]);
    expect(mergeFinancials(phone, laptop, NOW).supersededFromLocal).toEqual([]);
  });

  it("the replaced close's correction row is removed; the standing close's stays", () => {
    const phone = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T08:00:00.000Z", 398.6, { efDelta: -45.25 });
    const laptop = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T09:30:00.000Z", 401.15, { efDelta: -38.9 });
    const phoneRow = phone.periodCloses![0].emergencyFund!.transactionId!;
    const laptopRow = laptop.periodCloses![0].emergencyFund!.transactionId!;
    for (const r of both(phone, laptop)) {
      const tx = (id: string) => (r.data.transactions ?? []).find((t) => t.id === id)!;
      expect(tx(phoneRow).deletedAt).toBeUndefined();
      expect(tx(laptopRow).deletedAt).toBe(NOW.toISOString());
    }
  });

  it("a check-in made after the replaced close is kept: it's the later observation", () => {
    const phone = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T08:00:00.000Z", 398.6);
    const laptopClosed = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T09:30:00.000Z", 401.15);
    const checkIn = reanchorTrackedBalance(laptopClosed.trackedBalances![0], 377.05, 401.15, 89_500, "2026-10-02T12:00:00.000Z");
    const laptop = { ...laptopClosed, trackedBalances: [checkIn] };
    for (const r of both(phone, laptop)) expect(r.data.trackedBalances).toEqual([checkIn]);
  });
});

describe("what isn't merged keeps today's rule", () => {
  it("settings: this device's value is kept (the divergence notice names them)", () => {
    const r = mergeFinancials(base({ income: 3150.75, lbpRate: 89_500 }), base({ income: 3420.4, lbpRate: 89_700 }), NOW);
    expect(r.data.income).toBe(3150.75);
    expect(r.data.lbpRate).toBe(89_500);
  });

  it("the deletion registries combine, so a deletion travels to every device", () => {
    const a = base({ deletedKeys: { wishlist: [{ key: "w3", deletedAt: "2026-10-06T17:30:00.000Z" }] } });
    const b = base({ deletedKeys: { categoryRules: [{ key: "r9", deletedAt: "2026-10-05T08:00:00.000Z" }] } });
    for (const r of both(a, b)) {
      expect(r.data.deletedKeys?.wishlist).toEqual([{ key: "w3", deletedAt: "2026-10-06T17:30:00.000Z" }]);
      expect(r.data.deletedKeys?.categoryRules).toEqual([{ key: "r9", deletedAt: "2026-10-05T08:00:00.000Z" }]);
    }
  });
});

describe("the engine on its own", () => {
  it("mergeByKey: union, later edit wins, deletion beats any copy, order-independent", () => {
    type Row = { id: string; v: number; updatedAt?: string };
    const local: Row[] = [{ id: "a", v: 1, updatedAt: "2026-10-01T00:00:00.000Z" }, { id: "b", v: 2 }];
    const server: Row[] = [{ id: "a", v: 9, updatedAt: "2026-10-02T00:00:00.000Z" }, { id: "c", v: 3 }, { id: "b", v: 5, updatedAt: "2026-10-03T00:00:00.000Z" }];
    const tombs: Tombstone[] = [{ key: "c", deletedAt: "2026-10-01T00:00:00.000Z" }];
    const out = (l: Row[], s: Row[]) => mergeByKey(l, s, (r) => r.id, tombs).map((r) => `${r.id}${r.v}`).sort();
    expect(out(local, server)).toEqual(["a9", "b5"]);
    expect(out(server, local)).toEqual(["a9", "b5"]);
  });
});

describe("readers ignore a replaced close", () => {
  it("canReopen offers the standing close, not the replaced one", () => {
    const phone = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T08:00:00.000Z", 398.6);
    const laptop = closeOn(base({ trackedBalances: [CASH] }), "2026-09-27T09:30:00.000Z", 401.15);
    const merged = mergeFinancials(phone, laptop, NOW).data;
    const verdict = canReopen(merged, CYCLE, new Date("2026-10-06T19:12:00.000Z"));
    // Not "already-reopened": that answer belongs to the replaced close only.
    if (verdict.ok) expect(verdict.close.closedAt).toBe("2026-09-27T08:00:00.000Z");
    else expect(verdict.reason).not.toBe("already-reopened");
  });

  it("a replaced close's acknowledgement doesn't explain the standing close's anchor", () => {
    const standing = { accounts: [{ trackedBalanceId: CASH.id, acknowledgement: undefined }], closedAt: "2026-09-27T08:00:00.000Z" } as unknown as PeriodClose;
    const replaced = {
      accounts: [{ trackedBalanceId: CASH.id, acknowledgement: { note: "x", acknowledgedAt: "2026-09-27T09:30:00.000Z", discrepancy: -11.2, startingAt: ANCHOR } }],
      closedAt: "2026-09-27T09:30:00.000Z", reopenedAt: NOW.toISOString(), supersededAt: NOW.toISOString(),
    } as unknown as PeriodClose;
    expect(acknowledgementFor({ id: CASH.id, startingAt: ANCHOR }, -11.2, [standing, replaced])).toBeNull();
  });
});
