// DI-13 (2026-10-07): "Reset all data" with backup on was undone by the other
// device's next merge. The reset returned an empty copy with no deletion
// records, and the merge reads a missing item as one that side never had:
// transactions, the wishlist, categories, rules, tracked balances and closes
// came back by union, and the five lists that keep this device's copy simply
// stayed on the other device and went back up with its next push.
//
// Now the reset records a deletion (key and time, SYNC-1 step 2's list) for
// every item it clears, transactions included, and the merge honours those
// records for every collection, including the five lists that still keep this
// device's copy.
//
// Settings (income, rate, payday...) reset too (owner, session 11). Since plan
// H's rule, a device with a record of its last sync takes the reset copy's
// values for every setting it hasn't changed since. Session 11's item 2: a
// newer reset takes every setting a device hasn't changed since that reset,
// record or not (lib/reset-elsewhere.test.ts has the cases).
import { describe, it, expect } from "vitest";
import { seenOf } from "./syncSeen";
import { resetFinancials, DEFAULT_DATA, type LocalFinancials, type StoredTransaction, type PeriodClose } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { asCycleKey } from "./period";

const NOW = new Date("2026-10-07T18:00:00.000Z");
const tx = (id: string): StoredTransaction => ({ id, amount: 46.8, currency: "USD", bucket: "WANTS", category: "dining", description: id, date: "2026-10-01", updatedAt: "2026-10-01T12:00:00.000Z" } as StoredTransaction);
const close: PeriodClose = { cycleKey: asCycleKey("2026-08"), rangeStart: "2026-08-27", rangeEnd: "2026-09-26", startDayAtClose: 27, closedAt: "2026-09-27T08:00:00.000Z", accounts: [] };

/** A full account, as both devices hold it before the reset. */
const full = {
  ...DEFAULT_DATA, income: 3150.75, cycleStartDay: 27, syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" },
  transactions: [tx("t-bistro"), tx("t-kettle")],
  wishlist: [{ id: "w1", name: "Quartz lamp", emoji: "✨", price: 64.2, currency: "USD", priority: "medium", createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" }],
  customCategories: [{ value: "pharmacy", label: "Pharmacy", icon: "💊", updatedAt: "2026-10-01T09:00:00.000Z" }],
  categoryRules: [{ id: "r1", keyword: "Spinneys", category: "groceries", updatedAt: "2026-10-01T09:00:00.000Z" }],
  trackedBalances: [{ id: "tb-cash", name: "Wallet cash", paymentMethod: "cash", currency: "USD", startingBalance: 430, startingDate: "2026-08-26" }],
  periodCloses: [close],
  goals: [{ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 300, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" }],
  debts: [{ id: "d1", name: "Card", openingBalance: 2000, balance: 2000, apr: 18, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }],
  recurring: [{ id: "rc1", name: "Rent", emoji: "🏠", amount: 450, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-29", endDate: null, totalAmount: null, createdAt: "2026-01-20T09:00:00.000Z" }],
  assets: [{ id: "a1", name: "Gold coin", value: 640.25, currency: "USD", createdAt: "2026-02-01T09:00:00.000Z" }],
  cards: [{ id: "c1", type: "Visa", last4: "4421", label: "Visa •••• 4421" }],
} as unknown as LocalFinancials;

const ITEMS = (d: LocalFinancials) => ({
  transactions: d.transactions.map((t) => t.id), wishlist: (d.wishlist ?? []).map((w) => w.id),
  customCategories: (d.customCategories ?? []).map((c) => c.value), categoryRules: (d.categoryRules ?? []).map((r) => r.id),
  trackedBalances: (d.trackedBalances ?? []).map((t) => t.id), periodCloses: (d.periodCloses ?? []).length,
  goals: d.goals.map((g) => g.id), debts: d.debts.map((x) => x.id), recurring: d.recurring.map((r) => r.id),
  assets: d.assets.map((a) => a.id), cards: d.cards.map((c) => c.id),
});
const NONE = { transactions: [], wishlist: [], customCategories: [], categoryRules: [], trackedBalances: [], periodCloses: 0, goals: [], debts: [], recurring: [], assets: [], cards: [] };

describe("DI-13: the reset records a deletion for every item it clears", () => {
  const reset = resetFinancials(full, NOW);

  it("every collection, by its key, at the moment of the reset", () => {
    const keys = (c: keyof NonNullable<LocalFinancials["deletedKeys"]>) => reset.deletedKeys?.[c]?.map((t) => [t.key, t.deletedAt]);
    const at = NOW.toISOString();
    expect(keys("transactions")).toEqual([["t-bistro", at], ["t-kettle", at]]);
    expect(keys("wishlist")).toEqual([["w1", at]]);
    expect(keys("customCategories")).toEqual([["pharmacy", at]]);
    expect(keys("categoryRules")).toEqual([["r1", at]]);
    expect(keys("trackedBalances")).toEqual([["tb-cash", at]]);
    expect(keys("periodCloses")).toEqual([["2026-08|2026-09-27T08:00:00.000Z", at]]);
    expect(keys("goals")).toEqual([["g1", at]]);
    expect(keys("debts")).toEqual([["d1", at]]);
    expect(keys("recurring")).toEqual([["rc1", at]]);
    expect(keys("assets")).toEqual([["a1", at]]);
    expect(keys("cards")).toEqual([["c1", at]]);
  });

  it("keeps deletions recorded before the reset", () => {
    const earlier = { wishlist: [{ key: "w0", deletedAt: "2026-09-01T09:00:00.000Z" }] };
    const r = resetFinancials({ ...full, deletedKeys: earlier }, NOW);
    expect(r.deletedKeys?.wishlist?.map((t) => t.key)).toEqual(["w0", "w1"]);
  });

  it("still clears the data and keeps the backup choice", () => {
    expect(ITEMS(reset)).toEqual(NONE);
    expect(reset.income).toBe(0);
    expect(reset.syncChoice).toEqual(full.syncChoice);
  });
});

describe("DI-13: no merge brings the cleared items back", () => {
  const reset = resetFinancials(full, NOW);

  it("the other device, merging the reset copy from the server, removes every item", () => {
    const r = mergeFinancials(full, reset, new Date("2026-10-07T18:05:00.000Z"));
    expect(ITEMS(r.data)).toEqual(NONE);
    expect(r.transactions.addedFromServer).toBe(0);
    expect(r.transactions.conflicts).toEqual([]);
  });

  it("the device that reset, merging the other device's full copy, gets nothing back", () => {
    const r = mergeFinancials(reset, full, new Date("2026-10-07T18:05:00.000Z"));
    expect(ITEMS(r.data)).toEqual(NONE);
    expect(r.transactions.addedFromServer).toBe(0);
  });

  it("settings reset too: the other device's next sync takes the reset's income (owner, session 11)", () => {
    const r = mergeFinancials(full, reset, new Date("2026-10-07T18:05:00.000Z"), seenOf(full)); // it last synced the full copy
    expect(r.data.income).toBe(0);
    expect(r.data.cycleStartDay ?? 1).toBe(reset.cycleStartDay ?? 1); // payday too
    expect(r.clashes).toEqual([]); // nothing to settle: only the resetting device changed them
  });

  it("and the device that reset keeps its reset settings when the other device's old copy comes back", () => {
    expect(mergeFinancials(reset, full, new Date("2026-10-07T18:05:00.000Z"), seenOf(full)).data.income).toBe(0);
  });

  it("a device's first merge, with no record of a last sync, takes the reset's settings too (item 2)", () => {
    expect(mergeFinancials(full, reset).data.income).toBe(0);
  });

  it("something added after the reset, with a new key, is kept", () => {
    const after = { ...reset, transactions: [tx("t-new")], goals: [{ ...full.goals[0], id: "g2" }] } as LocalFinancials;
    const r = mergeFinancials(full, after);
    expect(r.data.transactions.map((t) => t.id)).toEqual(["t-new"]);
    expect(r.data.goals.map((g) => g.id)).toEqual([]); // the other device's own goals: g1 is deleted; g2 lives on the reset device only
    expect(mergeFinancials(after, full).data.goals.map((g) => g.id)).toEqual(["g2"]);
  });
});
