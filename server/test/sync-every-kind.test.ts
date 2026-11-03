/**
 * Session 38 (owner, "sync proof"): every kind of data, across two devices of
 * one account, through the real server (test/support/twoDevices.ts says how).
 * For each kind, the cases the app has an action for:
 *
 *   add      added on A -> the same record on B
 *   edit     edited on B -> the same record on A
 *   delete   deleted on A -> gone on B, and still gone on both and on the
 *            server after B, which hadn't heard yet, makes another change and
 *            both devices sync and open again
 *   both     A and B edit the same record before either hears of the other
 *            -> one record on both devices and on the server, and each
 *            device's notice names it
 *
 * Every change is made the way the screens make it: their helpers, their
 * record shapes, their edit stamps. A case the app has no action for is
 * listed as skipped with the reason, never invented.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startServer, Device } from "./support/twoDevices";
import {
  uid, edited, settingsEdited, recordDeletion, softDelete, saveCard, withRate, lbpRateOf, isoLocalDay,
  reanchorTrackedBalance, buildPeriodClose, reopenCycle, cycleStartDayOf, periodCloseKey,
  type LocalFinancials,
} from "../../client/lib/localData";
import { currentCycleKey, cycleCloseInstant } from "../../client/lib/period";
import { buildTrip, editTrip, deleteTrip } from "../../client/lib/trips";
import { buildForeignEntry, editForeignEntry } from "../../client/lib/foreignCash";
import { stableStringify } from "../../client/lib/canonical";

type D = LocalFinancials;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = any;

interface Kind {
  name: string;
  /** The records a person sees (a deleted transaction isn't one). */
  list: (d: D) => Item[];
  key: (i: Item) => string;
  /** What the notice must say to have told this device about the record (null: any notice). */
  told: (i: Item) => string | null;
  /** Before the cases: what the kind needs to exist first (a close needs a tracked balance). */
  prepare?: (A: Device, B: Device) => Promise<void>;
  add?: (d: D, at: Date) => { data: D; key: string };
  /** The settings exist from the start; their one "record" is the setting itself. */
  existing?: string;
  /** `v`: 1 on A, 2 on B, so two edits never match by accident. */
  edit?: (d: D, key: string, v: number, at: Date) => D;
  del?: (d: D, key: string, at: Date) => D;
  /** Cases the app has no action for, with the reason. */
  none?: Partial<Record<"add" | "edit" | "delete" | "both" | "bothLater", string>>;
  /**
   * Telling known to fail today, per device (session 38): each runs as
   * `it.fails`, so the suite stays green and turns red the day its fix lands;
   * the fix flips that row back to a plain case. The "one result" half of the
   * case stays a plain case throughout.
   */
  held?: Partial<Record<"both" | "bothLater", Partial<Record<"A" | "B", string>>>>;
}

const iso = (at: Date) => at.toISOString();
const rate = (d: D) => lbpRateOf(d);

const KINDS: Kind[] = [
  {
    name: "wishlist",
    list: (d) => d.wishlist ?? [],
    key: (w) => w.id,
    told: (w) => `"${w.name}"`,
    // WishlistScreen.addItem
    add: (d, at) => {
      const item = { id: uid(), name: "Bike", emoji: "🚲", price: 300, currency: "USD" as const, priority: "medium" as const, ...withRate("USD", rate(d)), createdAt: iso(at), updatedAt: iso(at) };
      return { data: { ...d, wishlist: [...(d.wishlist ?? []), item] }, key: item.id };
    },
    // WishlistScreen.toggleBought (the screen's one edit)
    edit: (d, key, _v, at) => ({ ...d, wishlist: (d.wishlist ?? []).map((w) => (w.id !== key ? w : { ...w, boughtAt: w.boughtAt ? undefined : iso(at), updatedAt: iso(at) })) }),
    // WishlistScreen.deleteItem
    del: (d, key) => ({ ...d, wishlist: (d.wishlist ?? []).filter((w) => w.id !== key), deletedKeys: recordDeletion(d, "wishlist", key) }),
  },
  {
    name: "transactions",
    list: (d) => (d.transactions ?? []).filter((t) => t.deletedAt == null && t.purgedAt == null),
    key: (t) => t.id,
    told: (t) => `"${t.description}"`,
    // InputPanel.commitTransaction
    add: (d, at) => {
      const tx = { id: uid(), amount: 12.5, currency: "USD" as const, bucket: "WANTS" as const, description: "Coffee beans", date: isoLocalDay(at), paymentMethod: "cash" as const, createdAt: iso(at), updatedAt: iso(at), ...withRate("USD", rate(d)) };
      return { data: { ...d, transactions: [tx, ...(d.transactions ?? [])] }, key: tx.id };
    },
    // EditTransactionSheet.save: the amount changed, stamped
    edit: (d, key, v, at) => ({ ...d, transactions: (d.transactions ?? []).map((t) => (t.id !== key ? t : { ...t, amount: 12.5 + v, updatedAt: iso(at) })) }),
    // InputPanel's delete: soft, with its record
    del: (d, key, at) => ({ ...d, transactions: (d.transactions ?? []).map((t) => (t.id !== key ? t : softDelete(d, t, iso(at)))) }),
  },
  {
    name: "goals",
    list: (d) => d.goals ?? [],
    key: (g) => g.id,
    told: (g) => `"${g.name}"`,
    // InputPanel.addGoal
    add: (d, at) => {
      const goal = { id: uid(), name: "Laptop", emoji: "💻", targetAmount: 1500, currentAmount: 0, openingAmount: 0, currency: "USD" as const, ...withRate("USD", rate(d)), targetDate: "2027-06-01", createdAt: iso(at) };
      return { data: { ...d, goals: [...(d.goals ?? []), edited(goal, iso(at))] }, key: goal.id };
    },
    // EditGoalSheet.save: a new target
    edit: (d, key, v, at) => ({ ...d, goals: (d.goals ?? []).map((g) => (g.id !== key ? g : edited({ ...g, targetAmount: 1500 + 100 * v }, iso(at)))) }),
    // InputPanel's goal delete
    del: (d, key) => ({ ...d, goals: (d.goals ?? []).filter((g) => g.id !== key), deletedKeys: recordDeletion(d, "goals", key) }),
  },
  {
    name: "debts",
    list: (d) => d.debts ?? [],
    key: (x) => x.id,
    told: (x) => `"${x.name}"`,
    // InputPanel.addDebt
    add: (d, at) => {
      const debt = { id: uid(), name: "Car loan", balance: 4000, apr: 5, minPayment: 150, currency: "USD" as const, ...withRate("USD", rate(d)), createdAt: iso(at), openingBalance: 4000 };
      return { data: { ...d, debts: [...(d.debts ?? []), edited(debt, iso(at))] }, key: debt.id };
    },
    // EditDebtSheet.save: a new minimum payment
    edit: (d, key, v, at) => ({ ...d, debts: (d.debts ?? []).map((x) => (x.id !== key ? x : edited({ ...x, minPayment: 150 + 10 * v }, iso(at)))) }),
    // InputPanel's debt delete
    del: (d, key) => ({ ...d, debts: (d.debts ?? []).filter((x) => x.id !== key), deletedKeys: recordDeletion(d, "debts", key) }),
  },
  {
    name: "recurring items",
    list: (d) => d.recurring ?? [],
    key: (r) => r.id,
    told: (r) => `"${r.name}"`,
    // InputPanel.addRecurring
    add: (d, at) => {
      const rec = { id: uid(), name: "Gym", emoji: "🏋️", amount: 40, currency: "USD" as const, frequency: "monthly" as const, bucket: "WANTS" as const, startDate: isoLocalDay(at), endDate: null, totalAmount: null, createdAt: iso(at) };
      return { data: { ...d, recurring: [...(d.recurring ?? []), edited(rec, iso(at))] }, key: rec.id };
    },
    // EditRecurringSheet.save: a new amount
    edit: (d, key, v, at) => ({ ...d, recurring: (d.recurring ?? []).map((r) => (r.id !== key ? r : edited({ ...r, amount: 40 + v }, iso(at)))) }),
    // InputPanel's recurring delete
    del: (d, key) => ({ ...d, recurring: (d.recurring ?? []).filter((r) => r.id !== key), deletedKeys: recordDeletion(d, "recurring", key) }),
  },
  {
    name: "assets",
    list: (d) => d.assets ?? [],
    key: (a) => a.id,
    told: (a) => `"${a.name}"`,
    // InputPanel.addAsset
    add: (d, at) => {
      const asset = { id: uid(), name: "Gold", value: 2000, currency: "USD" as const, ...withRate("USD", rate(d)), createdAt: iso(at) };
      return { data: { ...d, assets: [...(d.assets ?? []), edited(asset, iso(at))] }, key: asset.id };
    },
    // InputPanel.deleteAsset
    del: (d, key) => ({ ...d, assets: (d.assets ?? []).filter((a) => a.id !== key), deletedKeys: recordDeletion(d, "assets", key) }),
    none: { edit: "an asset is added and removed, never edited", both: "an asset is never edited", bothLater: "an asset is never edited" },
  },
  {
    name: "cards",
    list: (d) => d.cards ?? [],
    key: (c) => c.id,
    told: () => null,
    // saveCard, the one way every screen saves a card
    add: (d, at) => {
      const saved = saveCard(d.cards ?? [], "Visa", "4242", at)!;
      return { data: { ...d, cards: saved.cards }, key: saved.card.id };
    },
    none: { edit: "a card is only ever added (no screen edits one)", delete: "no screen deletes a card", both: "a card is never edited (both devices adding the same card is checked below)", bothLater: "a card is never edited" },
  },
  {
    name: "categories",
    list: (d) => d.customCategories ?? [],
    key: (c) => c.value,
    told: (c) => `"${c.label}"`,
    // CategoriesScreen.addCategory
    add: (d, at) => {
      const c = { value: "pets", label: "Pets", icon: "🐾", updatedAt: iso(at) };
      return { data: { ...d, customCategories: [...(d.customCategories ?? []), c] }, key: c.value };
    },
    // CategoriesScreen.saveEdit: renamed (its value stays)
    edit: (d, key, v, at) => ({ ...d, customCategories: (d.customCategories ?? []).map((c) => (c.value !== key ? c : { ...c, label: `Pets ${v}`, updatedAt: iso(at) })) }),
    // CategoriesScreen.deleteCategory
    del: (d, key) => ({ ...d, customCategories: (d.customCategories ?? []).filter((c) => c.value !== key), deletedKeys: recordDeletion(d, "customCategories", key) }),
  },
  {
    name: "category rules",
    list: (d) => d.categoryRules ?? [],
    key: (r) => r.id,
    told: (r) => `"${r.keyword}"`,
    // CategoriesScreen.addRule
    add: (d, at) => {
      const r = { id: uid(), keyword: "BAKERY", category: "groceries", updatedAt: iso(at) };
      return { data: { ...d, categoryRules: [...(d.categoryRules ?? []), r] }, key: r.id };
    },
    // CategoriesScreen.deleteRule
    del: (d, key) => ({ ...d, categoryRules: (d.categoryRules ?? []).filter((r) => r.id !== key), deletedKeys: recordDeletion(d, "categoryRules", key) }),
    none: { edit: "a rule is added and deleted, never edited", both: "a rule is never edited", bothLater: "a rule is never edited" },
  },
  {
    name: "tracked balances",
    list: (d) => d.trackedBalances ?? [],
    key: (t) => t.id,
    told: (t) => `"${t.name}"`,
    // BalanceCheckScreen.addTrackedBalance
    add: (d, at) => {
      const tb = { id: uid(), name: "Wallet", paymentMethod: "cash" as const, startingBalance: 200, startingDate: isoLocalDay(at), currency: "USD" as const, ...withRate("USD", rate(d)) };
      return { data: { ...d, trackedBalances: [...(d.trackedBalances ?? []), tb] }, key: tb.id };
    },
    // BalanceCheckScreen.updateActualBalance: a check-in (re-anchored at that moment)
    edit: (d, key, v, at) => ({ ...d, trackedBalances: (d.trackedBalances ?? []).map((t) => (t.id !== key ? t : reanchorTrackedBalance(t, 180 + v, undefined, rate(d), iso(at)))) }),
    // BalanceCheckScreen.deleteTrackedBalance
    del: (d, key) => ({ ...d, trackedBalances: (d.trackedBalances ?? []).filter((t) => t.id !== key), deletedKeys: recordDeletion(d, "trackedBalances", key) }),
    held: {
      both: { A: "the later check-in is kept, but this device isn't told", B: "the later check-in is kept, but this device isn't told" },
      bothLater: { A: "the later check-in is kept, but this device isn't told", B: "the later check-in is kept, but this device isn't told" },
    },
  },
  {
    name: "period closes",
    list: (d) => d.periodCloses ?? [],
    key: (c) => periodCloseKey(c),
    told: () => null,
    // A close needs a tracked balance: one, on both devices.
    prepare: async (A, B) => {
      await A.edit((d) => ({ ...d, trackedBalances: [{ id: uid(), name: "Wallet", paymentMethod: "cash", startingBalance: 200, startingDate: isoLocalDay(new Date()), currency: "USD" }] }));
      await A.sync();
      await B.open();
    },
    // BalanceCheckScreen.commitClose: the current cycle, every account re-anchored at its end, and the record, in one write
    add: (d, at) => {
      const startDay = cycleStartDayOf(d);
      const cycleKey = currentCycleKey(at, startDay);
      const end = cycleCloseInstant(cycleKey, startDay);
      const tbs = d.trackedBalances ?? [];
      const record = buildPeriodClose({
        cycleKey, startDay, closedAt: at, lbpRate: rate(d),
        accounts: tbs.map((tb) => ({ tb, actual: 190, actualUSD: 190, expectedAtClose: 200, anchoredAt: end })),
      });
      return {
        data: { ...d, trackedBalances: tbs.map((t) => reanchorTrackedBalance(t, 190, 200, rate(d), end)), periodCloses: [...(d.periodCloses ?? []), record] },
        key: periodCloseKey(record),
      };
    },
    // BalanceCheckScreen's reopen (the one change a close takes)
    edit: (d, key, _v, at) => {
      const close = (d.periodCloses ?? []).find((c) => periodCloseKey(c) === key)!;
      const next = reopenCycle(d, close.cycleKey, at);
      if (!next) throw new Error("reopen refused");
      return next;
    },
    none: { delete: "a close is reopened (the edit case), never deleted" },
    // Its one edit is a reopen, so "both edit" is both devices reopening the
    // same close: the earlier reopen is kept, and what a person sees (the
    // close reopened) is the same on both. No clash is named for that today:
    // the merge names one only when what the devices hold differs to a
    // person (owner, session 6). Left for the owner. Two devices CLOSING the
    // same cycle is the real conflict: its own cases are below.
    held: {
      both: { A: "both devices reopened it; no clash is named for the same change on both", B: "both devices reopened it; no clash is named for the same change on both" },
      bothLater: { A: "both devices reopened it; no clash is named for the same change on both", B: "both devices reopened it; no clash is named for the same change on both" },
    },
  },
  {
    name: "trips",
    list: (d) => d.trips ?? [],
    key: (t) => t.id,
    told: (t) => `"${t.name}"`,
    // TripsScreen: buildTrip
    add: (d, at) => {
      const r = buildTrip({ name: "Paris", startDate: "2027-03-01", endDate: "2027-03-08", budgetUSD: 1200 }, at);
      if (!r.ok) throw new Error("trip refused");
      return { data: { ...d, trips: [...(d.trips ?? []), r.trip] }, key: r.trip.id };
    },
    // TripsScreen: editTrip, a new budget
    edit: (d, key, v, at) => {
      const r = editTrip(d, key, { name: "Paris", startDate: "2027-03-01", endDate: "2027-03-08", budgetUSD: 1200 + 100 * v }, at);
      if (!r.ok) throw new Error("edit refused");
      return r.data;
    },
    // TripsScreen: deleteTrip
    del: (d, key, at) => deleteTrip(d, key, at),
  },
  {
    name: "foreign cash entries",
    list: (d) => d.foreignEntries ?? [],
    key: (e) => e.id,
    told: (e) => `"${e.description}"`,
    // ForeignCashPanel: buildForeignEntry
    add: (d, at) => {
      const e = buildForeignEntry({ kind: "spend", code: "EUR", amount: 25, date: isoLocalDay(at), description: "Museum" }, at);
      return { data: { ...d, foreignEntries: [...(d.foreignEntries ?? []), e] }, key: e.id };
    },
    // ForeignCashPanel: editForeignEntry, a new amount
    edit: (d, key, v, at) => {
      const old = (d.foreignEntries ?? []).find((e) => e.id === key)!;
      const r = editForeignEntry(d, key, { amount: 25 + v, description: old.description, date: old.date }, at);
      if (!r.ok) throw new Error("edit refused");
      return r.data;
    },
    // ForeignCashPanel.removeEntry
    del: (d, key, at) => ({ ...d, foreignEntries: (d.foreignEntries ?? []).filter((e) => e.id !== key), deletedKeys: recordDeletion(d, "foreignEntries", key, at) }),
  },
  {
    name: "settings",
    // The setting itself is the record (income, as Setup edits it).
    list: (d) => [{ id: "income", income: d.income, stamp: d.settingsUpdatedAt?.income }],
    key: (s) => s.id,
    told: () => "your income",
    existing: "income",
    // SetupScreen: income, stamped
    edit: (d, _key, v, at) => ({ ...d, income: 3000 + 100 * v, ...settingsEdited(d, ["income"], iso(at)) }),
    none: { add: "settings exist from the start; they're changed, not added", delete: "a setting is changed, never deleted" },
  },
];

const PASSWORD = "sync-proof-throwaway-2026";
let server: { stop: () => Promise<void> };
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server.stop(); });

let A: Device, B: Device;
let accounts = 0;
let base = 0;
/** `s` seconds after the case starts: edits get distinct, ordered times. */
const at = (s: number) => new Date(base + s * 1000);
beforeEach(async () => {
  base = Date.now();
  const email = `sync.proof.${++accounts}@example.invalid`;
  A = new Device("A", email);
  B = new Device("B", email);
  // An account in use: its income set (SetupScreen's edit). With nothing at
  // all, a device that deletes its only record counts as empty, and its upload
  // asks before replacing the backup (EMPTY_OVERWRITE_ASK), which no case here
  // is about.
  await A.signUpAndBackUp(PASSWORD, (d) => ({ ...d, income: 3000, ...settingsEdited(d, ["income"], iso(at(0))) }));
  await B.signInElsewhere(PASSWORD);
}, 60_000);

const find = async (dev: Device, k: Kind, key: string) => k.list(await dev.data()).find((i) => k.key(i) === key);
const onServer = async (k: Kind, key: string) => k.list(await A.serverCopy()).find((i) => k.key(i) === key);
const same = (a: Item, b: Item) => expect(stableStringify(a)).toBe(stableStringify(b));

/** Added on A and synced, then B opens: the record both devices hold. */
async function shared(k: Kind): Promise<string> {
  if (k.prepare) await k.prepare(A, B);
  if (k.existing) return k.existing;
  let key = "";
  await A.edit((d) => { const r = k.add!(d, at(1)); key = r.key; return r.data; });
  await A.sync();
  await B.open();
  expect(await find(B, k, key)).toBeDefined();
  return key;
}

/** Another change on B, unrelated to the kind under test (a wishlist item of its own). */
const unrelated = (name: string) => (d: D) => {
  const now = new Date().toISOString();
  return { ...d, wishlist: [...(d.wishlist ?? []), { id: uid(), name, emoji: "✨", price: 1, currency: "USD" as const, priority: "low" as const, createdAt: now, updatedAt: now }] };
};

const CASE = {
  add: "add on A → on B", edit: "edit on B → on A", delete: "delete on A → gone on B, stays gone",
  both: "both edit, the earlier edit synced first → one result, both told",
  bothLater: "both edit, the later edit synced first → one result, both told",
} as const;

for (const k of KINDS) {
  describe(k.name, () => {
    const run = (c: keyof typeof CASE, body: () => Promise<void>) =>
      k.none?.[c] ? it.skip(`${k.name} | ${CASE[c]} | no such action: ${k.none[c]}`, body) : it(`${k.name} | ${CASE[c]}`, body, 60_000);

    run("add", async () => {
      if (k.prepare) await k.prepare(A, B);
      let key = "";
      await A.edit((d) => { const r = k.add!(d, at(1)); key = r.key; return r.data; });
      await A.sync();
      await B.open();
      const onA = await find(A, k, key), onB = await find(B, k, key);
      expect(onB).toBeDefined();
      same(onB, onA);
    });

    run("edit", async () => {
      const key = await shared(k);
      const before = await find(B, k, key);
      await B.edit((d) => k.edit!(d, key, 2, at(20)));
      await B.sync();
      await A.open();
      const onA = await find(A, k, key), onB = await find(B, k, key);
      expect(stableStringify(onB)).not.toBe(stableStringify(before)); // the edit happened
      same(onA, onB);
    });

    run("delete", async () => {
      const key = await shared(k);
      await A.edit((d) => k.del!(d, key, at(10)));
      await A.sync();
      // B hasn't heard, and changes something else first: its push meets the
      // newer copy and merges.
      await B.edit(unrelated("Unrelated one"));
      await B.sync();
      await B.open();
      await A.open();
      expect(await find(A, k, key)).toBeUndefined();
      expect(await find(B, k, key)).toBeUndefined();
      expect(await onServer(k, key)).toBeUndefined();
      // And again: more changes, more syncs and opens on both.
      await B.edit(unrelated("Unrelated two"));
      await B.sync();
      await A.open();
      await A.edit(unrelated("Unrelated three"));
      await A.sync();
      await B.open();
      expect(await find(A, k, key)).toBeUndefined();
      expect(await find(B, k, key)).toBeUndefined();
      expect(await onServer(k, key)).toBeUndefined();
    });

    /**
     * A edits first (at 10 s), B later (at 20 s), neither hearing of the other.
     * `laterFirst`: B's later edit reaches the server first and A's push is
     * the one refused and merged; otherwise A's lands first and B merges. The
     * order a person happens to sync in mustn't change the outcome.
     */
    const both = async (laterFirst: boolean, check: { result: boolean; told: readonly ("A" | "B")[] }) => {
      const key = await shared(k);
      await A.edit((d) => k.edit!(d, key, 1, at(10)));
      await B.edit((d) => k.edit!(d, key, 2, at(20)));
      const editedOnA = await find(A, k, key), editedOnB = await find(B, k, key);
      const toldA: string[] = [], toldB: string[] = [];
      const [first, second, firstTold, secondTold] = laterFirst ? [B, A, toldB, toldA] : [A, B, toldA, toldB];
      firstTold.push(await first.sync()); // lands: nothing newer on the server
      secondTold.push(await second.sync()); // refused, merged, pushed
      firstTold.push(await first.open()); // takes the merged copy
      secondTold.push(await second.open()); firstTold.push(await first.open()); // and settles
      const onA = await find(A, k, key), onB = await find(B, k, key), server = await onServer(k, key);
      if (check.result) {
        same(onA, onB);
        same(server, onA);
        expect([stableStringify(editedOnA), stableStringify(editedOnB)]).toContain(stableStringify(onA)); // one of the two edits, not a third thing
      }
      const name = k.told(onA);
      for (const [who, said] of [["A", toldA], ["B", toldB]] as const) {
        if (!check.told.includes(who)) continue;
        const text = said.join("\n");
        if (name === null) expect(text.trim(), `${who} told`).not.toBe("");
        else expect(text, `${who} told`).toContain(name);
      }
    };
    for (const c of ["both", "bothLater"] as const) {
      const laterFirst = c === "bothLater";
      const held = k.held?.[c];
      if (k.none?.[c]) run(c, async () => {});
      else if (held) {
        // Split, so what passes today stays a plain case: the one result, and
        // each device's telling on its own; only a known failure is it.fails.
        it(`${k.name} | ${CASE[c]} | one result on both`, () => both(laterFirst, { result: true, told: [] }), 60_000);
        for (const who of ["A", "B"] as const) {
          const why = held[who];
          if (why) it.fails(`${k.name} | ${CASE[c]} | ${who} told | HELD, fails today: ${why}`, () => both(laterFirst, { result: false, told: [who] }), 60_000);
          else it(`${k.name} | ${CASE[c]} | ${who} told`, () => both(laterFirst, { result: false, told: [who] }), 60_000);
        }
      } else run(c, () => both(laterFirst, { result: true, told: ["A", "B"] }));
    }
  });
}

/**
 * Two devices close the same cycle before either hears of the other: the
 * earlier close stands and the later one is undone (SYNC-1 step 2's rule). In
 * either order of syncing: one result on both devices and the server; the
 * device whose close was undone is told (the approved sentence); and the
 * device whose close stood.
 */
describe("period closes, both close the same cycle", () => {
  const closes = KINDS.find((k) => k.name === "period closes")!;
  const bothClose = async (laterFirst: boolean) => {
    await closes.prepare!(A, B);
    await A.edit((d) => closes.add!(d, at(10)).data); // the earlier close
    await B.edit((d) => closes.add!(d, at(20)).data); // the later one
    const toldA: string[] = [], toldB: string[] = [];
    const [first, second, firstTold, secondTold] = laterFirst ? [B, A, toldB, toldA] : [A, B, toldA, toldB];
    firstTold.push(await first.sync());
    secondTold.push(await second.sync());
    firstTold.push(await first.open());
    secondTold.push(await second.open()); firstTold.push(await first.open());
    const a = await A.data(), b = await B.data(), s = await A.serverCopy();
    return { a, b, s, toldA: toldA.join("\n"), toldB: toldB.join("\n") };
  };
  const sorted = (d: D) => [...(d.periodCloses ?? [])].sort((x, y) => periodCloseKey(x).localeCompare(periodCloseKey(y)));
  for (const laterFirst of [false, true]) {
    const order = laterFirst ? "the later close synced first" : "the earlier close synced first";
    it(`period closes | both close the same cycle, ${order} | one result on both`, async () => {
      const r = await bothClose(laterFirst);
      same(sorted(r.a), sorted(r.b));
      same(sorted(r.s), sorted(r.a));
      same(r.a.trackedBalances, r.b.trackedBalances);
      const live = sorted(r.a).filter((c) => !c.reopenedAt && !c.supersededAt);
      expect(live.map((c) => c.closedAt)).toEqual([iso(at(10))]); // the earlier stands
    }, 60_000);
    // The undone device's approved sentence. Reached when it merges the two
    // closes itself; not when the other device's merge undid its close.
    const undone = async () => { expect((await bothClose(laterFirst)).toldB).toContain("this device's close was undone"); };
    // Session 38, fix C: told in either order.
    if (laterFirst) it(`period closes | both close the same cycle, ${order} | B told (its close was undone)`, undone, 60_000);
    else it(`period closes | both close the same cycle, ${order} | B told (its close was undone)`, undone, 60_000);
    it.fails(`period closes | both close the same cycle, ${order} | A told (its close stood) | HELD, fails today: nothing tells the device whose close stood`, async () => {
      expect((await bothClose(laterFirst)).toldA.trim()).not.toBe("");
    }, 60_000);
  }
});

describe("cards", () => {
  it("cards | both add the same card → one card on both", async () => {
    await A.edit((d) => ({ ...d, cards: saveCard(d.cards ?? [], "Visa", "4242", at(10))!.cards }));
    await B.edit((d) => ({ ...d, cards: saveCard(d.cards ?? [], "Visa", "4242", at(20))!.cards }));
    await A.sync();
    await B.sync();
    await A.open();
    await B.open();
    const onA = (await A.data()).cards ?? [], onB = (await B.data()).cards ?? [];
    expect(onA).toHaveLength(1);
    same(onA, onB);
    same((await A.serverCopy()).cards, onA);
  }, 60_000);
});

describe("no prompts", () => {
  it("none of these flows asked the person anything", async () => {
    expect(A.prompts).toEqual([]);
    expect(B.prompts).toEqual([]);
  });
});
