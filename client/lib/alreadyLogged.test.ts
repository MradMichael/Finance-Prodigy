// TODO 121 (owner, session 63, item 2; option b; approved in full, session 64): "Already logged" on the due-date reminder.
// A recurring bill also logged by hand was confirmed and logged twice. The reminder now finds the row already
// logged for the cycle it asks about, and links it (the row gains the item's recurringId and the cycle's day)
// instead of logging a new one. The rule (FIX_PLANS session 63, item 2): live, tied to nothing, spending, the
// item's name (ignoring case and spaces), its currency, within 50% of its amount, within half a cycle of the due
// day; the nearest wins.
import { describe, it, expect } from "vitest";
import { HALF_CYCLE_DAYS, LOGGED_TEXT, loggedEntryFor, loggedEntries, linkLoggedEntry, unlinkLoggedEntry } from "./alreadyLogged";
import { DEFAULT_DATA, nextConfirmTarget, type LocalFinancials, type RecurringFrequency, type StoredRecurring, type StoredTransaction } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";
import type { CalendarDay } from "./calendarDay";
import { totalSpent } from "./spending";

const NETFLIX = { id: "r-netflix", name: "Netflix", emoji: "📺", amount: 15, currency: "USD", frequency: "monthly", bucket: "WANTS", startDate: "2026-11-24", endDate: null, totalAmount: null, createdAt: "2026-10-24T18:00:00.000Z" } as StoredRecurring;
const DUE = "2026-11-24";
const TODAY = "2026-11-24" as CalendarDay;
let n = 0;
const row = (o: Partial<StoredTransaction> = {}): StoredTransaction =>
  ({ id: `t${n++}`, amount: 15, currency: "USD", bucket: "WANTS", description: "Netflix", date: "2026-11-22", paymentMethod: "card", createdAt: "2026-11-22T09:00:00.000Z", ...o }) as StoredTransaction;
const data = (transactions: StoredTransaction[], recurring: StoredRecurring[] = [NETFLIX]) =>
  ({ ...DEFAULT_DATA, income: 3000, recurring, transactions }) as LocalFinancials;
const found = (rows: StoredTransaction[], r: StoredRecurring = NETFLIX, due = DUE) => loggedEntryFor(r, due, rows)?.id ?? null;
const addDays = (iso: string, d: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + d)).toISOString().slice(0, 10);

describe("the rule: which row counts as already logged", () => {
  it("the item's name, ignoring case and extra spaces", () => {
    const r = row({ description: "  NETFLIX " });
    expect(found([r])).toBe(r.id);
    expect(found([row({ description: "Net  flix" })])).toBeNull();
    expect(found([row({ description: "Netflix subscription" })])).toBeNull();
  });

  it("in the item's currency only (nothing converted)", () => {
    expect(found([row({ currency: "LBP", amount: 1_342_500 })])).toBeNull();
    // Session 63 perturbation A4: the row above also fails the band, so only this one shows the currency check.
    expect(found([row({ currency: "LBP", amount: 15 })])).toBeNull();
  });

  it("within 50% of the item's amount, both edges counted", () => {
    const low = row({ amount: 7.5 }), high = row({ amount: 22.5 });
    expect(found([low])).toBe(low.id);
    expect(found([high])).toBe(high.id);
    expect(found([row({ amount: 7.49 })])).toBeNull();
    expect(found([row({ amount: 22.51 })])).toBeNull();
    expect(found([row({ amount: 0 })])).toBeNull();
  });

  it("within half a cycle of the due day: 15 days either side for a monthly item, both edges counted", () => {
    expect(HALF_CYCLE_DAYS).toEqual({ weekly: 3, biweekly: 7, monthly: 15, every2months: 30, quarterly: 45, biannually: 91, yearly: 182 });
    const early = row({ date: addDays(DUE, -15) }), late = row({ date: addDays(DUE, 15) });
    expect(found([early])).toBe(early.id);
    expect(found([late])).toBe(late.id);
    expect(found([row({ date: addDays(DUE, -16) })])).toBeNull();
    expect(found([row({ date: addDays(DUE, 16) })])).toBeNull();
  });

  it("the payment that made the item (a month before its first due day) is not offered for it", () => {
    expect(found([row({ date: "2026-10-24" })])).toBeNull();
  });

  it.each([
    ["weekly", 3], ["biweekly", 7], ["every2months", 30], ["quarterly", 45], ["biannually", 91], ["yearly", 182],
  ] as [RecurringFrequency, number][])("%s: within %i days", (frequency, half) => {
    const r = { ...NETFLIX, frequency };
    const edge = row({ date: addDays(DUE, -half) });
    expect(found([edge], r)).toBe(edge.id);
    expect(found([row({ date: addDays(DUE, -half - 1) })], r)).toBeNull();
    expect(found([row({ date: addDays(DUE, half + 1) })], r)).toBeNull();
  });

  it.each([
    ["deleted", { deletedAt: "2026-11-23T00:00:00.000Z" }],
    ["purged", { purgedAt: "2026-11-23T00:00:00.000Z" }],
    ["already a confirmation", { recurringId: "r-other", cycleDate: "2026-11-20" }],
    ["detached from a cycle earlier", { cycleDate: null }],
    ["an extra payment", { extraForRecurringId: "r-netflix" }],
    ["a debt payment", { debtId: "d1" }],
    ["a goal contribution", { goalId: "g1" }],
    ["foreign cash", { fx: { code: "EUR", amount: 14, kind: "exchange" } }],
    ["a transfer leg", { bucket: "TRANSFER", linkedPaymentId: "L1" }],
    ["income", { bucket: "INCOME" }],
  ] as [string, Partial<StoredTransaction>][])("not offered: %s", (_name, o) => {
    expect(found([row(o)])).toBeNull();
  });

  it("Needs, Wants and Savings rows are all offered", () => {
    for (const bucket of ["NEEDS", "WANTS", "SAVINGS"] as const) { const r = row({ bucket }); expect(found([r])).toBe(r.id); }
  });

  it("several: the one nearest the due day; on a tie, the earlier date, then the earlier entry", () => {
    const far = row({ date: "2026-11-15" }), near = row({ date: "2026-11-27" }), nearer = row({ date: "2026-11-23" });
    expect(found([far, near, nearer])).toBe(nearer.id);
    const before = row({ date: "2026-11-22" }), after = row({ date: "2026-11-26" });
    expect(found([after, before])).toBe(before.id);
    const first = row({ date: "2026-11-22", createdAt: "2026-11-22T08:00:00.000Z" }), second = row({ date: "2026-11-22", createdAt: "2026-11-22T10:00:00.000Z" });
    expect(found([second, first])).toBe(first.id);
  });

  it("an item with no amount finds nothing", () => {
    expect(found([row({ amount: 0 })], { ...NETFLIX, amount: 0 })).toBeNull();
  });
});

describe("the reminder's rows: one per item it can show", () => {
  it("each renewal's cycle, by item id, with the row's own description (trimmed), date, amount and currency", () => {
    const hand = row({ id: "hand", amount: 16, description: " Netflix " }); // the row as typed, trimmed
    expect(loggedEntries(data([hand]), [{ id: "r-netflix", dueDate: DUE }, { id: "r-gone", dueDate: DUE }])).toEqual({
      "r-netflix": { txId: "hand", description: "Netflix", date: "2026-11-22", amount: 16, currency: "USD" },
    });
  });
});

describe("Already logged: the link, and its Undo", () => {
  const hand = row({ id: "hand" });
  const AT = "2026-11-24T12:00:00.000Z", LATER = "2026-11-24T12:05:00.000Z";

  it("writes the item and the cycle's day on the row, and a new updatedAt; nothing else", () => {
    const after = linkLoggedEntry(data([hand]), "r-netflix", "hand", DUE, TODAY, AT)!;
    expect(after.transactions).toEqual([{ ...hand, recurringId: "r-netflix", cycleDate: DUE, updatedAt: AT }]);
  });

  it("the cycle is paid (the reminder moves to December) and November's spending is unchanged: one $15", () => {
    const before = data([hand]);
    const after = linkLoggedEntry(before, "r-netflix", "hand", DUE, TODAY, AT)!;
    expect(nextConfirmTarget(NETFLIX, before.transactions, before, TODAY)!.dueDate.toISOString().slice(0, 10)).toBe(DUE);
    expect(nextConfirmTarget(NETFLIX, after.transactions, after, TODAY)!.dueDate.toISOString().slice(0, 10)).toBe("2026-12-24");
    expect(after.transactions).toHaveLength(1);
    expect(totalSpent(after.transactions, (t) => t.amount)).toBe(15);
  });

  it("refuses a row that no longer matches, a cycle that isn't the one asked about, or an item that's gone", () => {
    expect(linkLoggedEntry(data([{ ...hand, amount: 40 }]), "r-netflix", "hand", DUE, TODAY, AT)).toBeNull();
    expect(linkLoggedEntry(data([hand]), "r-netflix", "hand", "2026-12-24", TODAY, AT)).toBeNull();
    // Session 63 perturbation A11: a row inside December's window, while the reminder asks about November.
    const dec = row({ id: "dec", date: "2026-12-20" });
    expect(linkLoggedEntry(data([dec]), "r-netflix", "dec", "2026-12-24", TODAY, AT)).toBeNull();
    expect(linkLoggedEntry(data([hand], []), "r-netflix", "hand", DUE, TODAY, AT)).toBeNull();
    const other = row({ id: "other", date: "2026-11-20" });
    expect(linkLoggedEntry(data([hand, other]), "r-netflix", "other", DUE, TODAY, AT)).toBeNull(); // not the row offered
  });

  it("Undo takes both fields off and writes a newer updatedAt; the cycle is outstanding again", () => {
    const linked = linkLoggedEntry(data([hand]), "r-netflix", "hand", DUE, TODAY, AT)!;
    const undone = unlinkLoggedEntry(linked, "r-netflix", "hand", DUE, LATER)!;
    expect(undone.transactions).toEqual([{ ...hand, updatedAt: LATER }]);
    expect("recurringId" in undone.transactions[0] || "cycleDate" in undone.transactions[0]).toBe(false);
    expect(nextConfirmTarget(NETFLIX, undone.transactions, undone, TODAY)!.dueDate.toISOString().slice(0, 10)).toBe(DUE);
  });

  it("Undo refuses a row whose link was changed since (detached, or moved to another cycle)", () => {
    const linked = linkLoggedEntry(data([hand]), "r-netflix", "hand", DUE, TODAY, AT)!;
    const detached = { ...linked, transactions: linked.transactions.map((t) => ({ ...t, cycleDate: null })) } as LocalFinancials;
    expect(unlinkLoggedEntry(detached, "r-netflix", "hand", DUE, LATER)).toBeNull();
    expect(unlinkLoggedEntry(linked, "r-netflix", "hand", "2026-10-24", LATER)).toBeNull();
    expect(unlinkLoggedEntry(linked, "r-netflix", "nope", DUE, LATER)).toBeNull();
  });

  it("every sentence, as drafted", () => {
    expect(LOGGED_TEXT.found("Netflix", "22/11/2026", "$15.00")).toBe("You logged Netflix on 22/11/2026 ($15.00).");
    expect(LOGGED_TEXT.already).toBe("Already logged");
    expect(LOGGED_TEXT.linked("Netflix", "22/11/2026")).toBe("Netflix: your entry of 22/11/2026 now counts as this payment. Nothing new was logged.");
    expect(LOGGED_TEXT.undo).toBe("Undo");
  });
});

describe("in a sync (no new field: an ordinary edit of one row)", () => {
  const hand = row({ id: "hand", updatedAt: "2026-11-22T09:00:00.000Z" });
  const T0 = new Date("2026-11-24T12:10:00.000Z");
  const AT = "2026-11-24T12:00:00.000Z", LATER = "2026-11-24T12:05:00.000Z";
  const merged = (local: LocalFinancials, server: LocalFinancials, last?: LocalFinancials) =>
    mergeFinancials(local, server, T0, last ? seenOf(last) : undefined).data.transactions.find((t) => t.id === "hand");

  it("linked here, the server's copy still unlinked (an older build's): the link is kept", () => {
    const before = data([hand]);
    const linked = linkLoggedEntry(before, "r-netflix", "hand", DUE, TODAY, AT)!;
    expect(merged(linked, before, before)).toMatchObject({ recurringId: "r-netflix", cycleDate: DUE });
    expect(merged(linked, before)).toMatchObject({ recurringId: "r-netflix", cycleDate: DUE });
  });

  it("linked on the other device: taken here", () => {
    const before = data([hand]);
    const linked = linkLoggedEntry(before, "r-netflix", "hand", DUE, TODAY, AT)!;
    expect(merged(before, linked, before)).toMatchObject({ recurringId: "r-netflix", cycleDate: DUE });
  });

  it("an Undo here after the link was synced holds (the server still has the link)", () => {
    const linked = linkLoggedEntry(data([hand]), "r-netflix", "hand", DUE, TODAY, AT)!;
    const undone = unlinkLoggedEntry(linked, "r-netflix", "hand", DUE, LATER)!;
    const m = merged(undone, linked, linked)!;
    expect(m.recurringId).toBeUndefined();
    expect(m.cycleDate).toBeUndefined();
    expect(merged(undone, linked)!.recurringId).toBeUndefined();
  });
});
