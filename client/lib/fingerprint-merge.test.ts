// Plan H, part 5b (owner-approved, session 5): the fingerprint rule.
//
// Each device keeps, per key, a fingerprint of the record's content as of its
// last sync (lib/syncSeen.ts; encrypted, outside the synced data). At merge,
// per key:
//   neither side changed since then   -> nothing to do
//   only one side changed             -> take that side, NO clock compared
//   both changed                      -> later updatedAt; a tie goes to the
//                                        content tie-break; the clash is named
// A key never seen is kept (union). A recorded deletion beats any copy.
// With no fingerprints yet (the first merge after the update) the merge is
// exactly today's.
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, recordDeletion, type LocalFinancials, type StoredGoal, type StoredDebt, type StoredTransaction } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { seenOf, fingerprint } from "./syncSeen";

const T0 = new Date("2026-10-08T12:00:00.000Z");
const goal = (o: Partial<StoredGoal> = {}): StoredGoal => ({
  id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01",
  createdAt: "2026-05-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...o,
});
const debt = (o: Partial<StoredDebt> = {}): StoredDebt =>
  ({ id: "d1", name: "Card", openingBalance: 2000, balance: 2000, apr: 18, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", ...o }) as StoredDebt;
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, goals: [goal()], ...o }) as LocalFinancials;
const merge = (a: LocalFinancials, b: LocalFinancials, seen = seenOf(BASE)) => mergeFinancials(a, b, T0, seen);
/** What both devices held at their last sync. */
const BASE = base();

describe("one side changed: that side, whatever the clocks say", () => {
  it("the server's edit is taken even though its clock is behind", () => {
    const server = base({ goals: [goal({ name: "MacBook", updatedAt: "2026-09-01T00:00:00.000Z" })] }); // an older stamp
    for (const d of [merge(BASE, server).data, mergeFinancials(server, BASE, T0, seenOf(BASE)).data]) expect(d.goals[0].name).toBe("MacBook");
  });

  it("a 10-minute clock skew either way never lets the unchanged copy win", () => {
    for (const skew of [-10, 10]) {
      const at = new Date(Date.parse("2026-10-01T09:00:00.000Z") + skew * 60_000).toISOString();
      const local = base({ goals: [goal({ targetAmount: 1500, updatedAt: at })] });
      expect(merge(local, BASE).data.goals[0].targetAmount).toBe(1500);
      expect(mergeFinancials(BASE, local, T0, seenOf(BASE)).data.goals[0].targetAmount).toBe(1500);
    }
  });

  it("is reported as no clash", () => {
    const server = base({ goals: [goal({ name: "MacBook" })] });
    expect(merge(BASE, server).clashes).toEqual([]);
  });
});

describe("both sides changed: the later edit, named", () => {
  it("the later updatedAt wins, from either side, and the clash names the goal", () => {
    const local = base({ goals: [goal({ name: "Laptop Pro", updatedAt: "2026-10-05T10:00:00.000Z" })] });
    const server = base({ goals: [goal({ name: "MacBook", updatedAt: "2026-10-06T10:00:00.000Z" })] });
    for (const r of [merge(local, server), mergeFinancials(server, local, T0, seenOf(BASE))]) {
      expect(r.data.goals[0].name).toBe("MacBook");
      expect(r.clashes).toEqual([{ kind: "goal", name: "MacBook", later: true }]);
    }
  });

  it("a tie goes to the content tie-break, the same from either side", () => {
    const at = "2026-10-05T10:00:00.000Z";
    const a = base({ goals: [goal({ name: "A", updatedAt: at })] }), b = base({ goals: [goal({ name: "B", updatedAt: at })] });
    expect(merge(a, b).data.goals[0].name).toBe(mergeFinancials(b, a, T0, seenOf(BASE)).data.goals[0].name);
  });

  it("achievedAt is never cleared by a merge: the earliest one stays", () => {
    const local = base({ goals: [goal({ achievedAt: "2026-10-02", updatedAt: "2026-10-02T10:00:00.000Z" })] });
    const server = base({ goals: [goal({ name: "MacBook", updatedAt: "2026-10-06T10:00:00.000Z" })] }); // later, without it
    expect(merge(local, server).data.goals[0]).toMatchObject({ name: "MacBook", achievedAt: "2026-10-02" });
  });
});

describe("a debt's paidOffAt is never cleared by a merge (session 6)", () => {
  // The same protection as a goal's achievedAt. Only a person clears it, and
  // no screen does today: a merge keeps the earliest stamp either side holds.
  const paid = debt({ paidOffAt: "2026-10-03T09:00:00.000Z", updatedAt: "2026-10-03T09:00:00.000Z" });
  const renamed = debt({ name: "Visa card", updatedAt: "2026-10-05T09:00:00.000Z" }); // later, and without it
  const b = base({ debts: [debt()] });
  it("a clash the later rename wins keeps 'Paid', from either side", () => {
    for (const r of [mergeFinancials(base({ debts: [paid] }), base({ debts: [renamed] }), T0, seenOf(b)), mergeFinancials(base({ debts: [renamed] }), base({ debts: [paid] }), T0, seenOf(b))]) {
      expect(r.data.debts[0]).toMatchObject({ name: "Visa card", paidOffAt: "2026-10-03T09:00:00.000Z" });
    }
  });
  it("two stamps: the earlier stays", () => {
    const later = debt({ paidOffAt: "2026-10-04T09:00:00.000Z", updatedAt: "2026-10-06T09:00:00.000Z" });
    expect(mergeFinancials(base({ debts: [paid] }), base({ debts: [later] }), T0, seenOf(b)).data.debts[0].paidOffAt).toBe("2026-10-03T09:00:00.000Z");
  });
});

describe("keys and deletions", () => {
  it("a goal added on either side is kept (union)", () => {
    const local = base({ goals: [goal(), goal({ id: "g2", name: "Car" })] });
    const server = base({ goals: [goal(), goal({ id: "g3", name: "Trip" })] });
    expect(merge(local, server).data.goals.map((g) => g.id).sort()).toEqual(["g1", "g2", "g3"]);
  });

  it("a recorded deletion beats a copy the other device still holds", () => {
    const local = base({ goals: [], deletedKeys: recordDeletion(BASE, "goals", "g1", T0) });
    expect(merge(local, BASE).data.goals).toEqual([]);
    expect(mergeFinancials(BASE, local, T0, seenOf(BASE)).data.goals).toEqual([]);
  });

  it("a debt deleted on one device and paid on the other ends as a local delete does today: debt gone, payment kept", () => {
    const pay: StoredTransaction = { id: "p1", amount: 50, currency: "USD", bucket: "NEEDS", description: "Debt payment: Card", date: "2026-10-07", debtId: "d1" };
    const both = base({ debts: [debt()] });
    const deleted = { ...both, debts: [], deletedKeys: recordDeletion(both, "debts", "d1", T0) } as LocalFinancials;
    const paid = { ...both, transactions: [pay] } as LocalFinancials;
    for (const r of [mergeFinancials(deleted, paid, T0, seenOf(both)), mergeFinancials(paid, deleted, T0, seenOf(both))]) {
      expect(r.data.debts).toEqual([]);
      expect(r.data.transactions.map((t) => [t.id, t.debtId])).toEqual([["p1", "d1"]]);
    }
  });
});

describe("settings", () => {
  it("a one-sided change is taken without clocks; a two-sided one goes to the later edit, with both values", () => {
    const server = base({ income: 3400, settingsUpdatedAt: { income: "2026-09-01T00:00:00.000Z" } });
    expect(merge(BASE, server).data.income).toBe(3400);
    const local = base({ income: 3200, settingsUpdatedAt: { income: "2026-10-05T00:00:00.000Z" } });
    const r = merge(local, base({ income: 3400, settingsUpdatedAt: { income: "2026-10-06T00:00:00.000Z" } }));
    expect(r.data.income).toBe(3400);
    expect(r.clashes).toEqual([{ kind: "setting", setting: "income", kept: 3400, other: 3200 }]);
  });

  it("both devices healing one split alike is not named: the values a person sees are the same", () => {
    const healed = (at: string) => base({ budgetRule: "custom", budgetCustomNeeds: 80, budgetCustomWants: 10, budgetSplitHealedAt: at, budgetSplitHealedFrom: { needs: 85, wants: 15 } });
    const b = base({ budgetRule: "custom", budgetCustomNeeds: 85, budgetCustomWants: 15 });
    const r = mergeFinancials(healed("2026-10-07T08:00:00.000Z"), healed("2026-10-07T09:00:00.000Z"), T0, seenOf(b));
    expect([r.data.budgetCustomNeeds, r.data.budgetCustomWants]).toEqual([80, 10]);
    expect(r.clashes).toEqual([]);
  });

  it("the budget split travels as one setting", () => {
    const server = base({ budgetRule: "custom", budgetCustomNeeds: 60, budgetCustomWants: 25 });
    const out = merge(BASE, server).data;
    expect([out.budgetRule, out.budgetCustomNeeds, out.budgetCustomWants]).toEqual(["custom", 60, 25]);
  });
});

describe("histories", () => {
  it("a past entry changed on one side is taken; both changed, the later `at` wins", () => {
    const h = (value: number, at?: string) => [{ ym: "2026-08", value, ...(at ? { at } : {}) }];
    const b = base({ incomeHistory: h(3000) as LocalFinancials["incomeHistory"] });
    const seen = seenOf(b);
    expect(mergeFinancials(b, { ...b, incomeHistory: h(3100) } as LocalFinancials, T0, seen).data.incomeHistory).toEqual(h(3100));
    const r = mergeFinancials({ ...b, incomeHistory: h(3200, "2026-09-01T00:00:00.000Z") } as LocalFinancials, { ...b, incomeHistory: h(3100, "2026-09-02T00:00:00.000Z") } as LocalFinancials, T0, seen);
    expect(r.data.incomeHistory).toEqual(h(3100, "2026-09-02T00:00:00.000Z"));
  });
});

describe("the wishlist, categories and rules are on the same rule", () => {
  it("a one-sided change wins over the other copy's later stamp", () => {
    const wish = (name: string, updatedAt: string) => ({ id: "w1", name, emoji: "✨", price: 64.2, currency: "USD", priority: "medium", createdAt: "2026-10-01T09:00:00.000Z", updatedAt });
    const b = base({ wishlist: [wish("Lamp", "2026-10-07T00:00:00.000Z")] as LocalFinancials["wishlist"] });
    // The server changed it with a slow clock; this device's copy is unchanged (its stamp is later).
    const server = { ...b, wishlist: [wish("Quartz lamp", "2026-10-06T00:00:00.000Z")] } as LocalFinancials;
    expect(mergeFinancials(b, server, T0, seenOf(b)).data.wishlist?.[0].name).toBe("Quartz lamp");
  });
});

describe("no fingerprints yet: exactly today's merge", () => {
  it("the first merge after the update gives today's result", () => {
    const local = base({ goals: [goal({ name: "Laptop Pro" })], income: 3200 });
    const server = base({ goals: [goal({ name: "MacBook" }), goal({ id: "g9", name: "Trip" })], income: 3400 });
    const today = mergeFinancials(local, server, T0);
    const firstAfter = mergeFinancials(local, server, T0, null);
    expect(firstAfter.data).toEqual(today.data);
    expect(firstAfter.data.goals.map((g) => g.name)).toEqual(["Laptop Pro"]); // this device's copy, as today
    expect(firstAfter.data.income).toBe(3200);
  });
});

describe("fingerprints", () => {
  it("are content, in key order: the same record twice, the same print; any change, another", () => {
    const g = goal();
    const reordered = Object.fromEntries(Object.entries(g).reverse());
    expect(fingerprint(reordered)).toBe(fingerprint(g));
    expect(fingerprint({ ...g, name: "x" })).not.toBe(fingerprint(g));
  });
});
