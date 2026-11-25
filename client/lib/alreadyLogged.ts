// "Already logged" on the due-date reminder (TODO 121; owner, session 63, item 2, option b; approved
// in full, session 64). A recurring bill the person also logs by hand was asked about anyway, and "Yes, it's paid" logged it a
// second time: a cycle counts as paid only through a row carrying the item's recurringId and the cycle's day
// (confirmedCycles), and a row logged by hand carries neither. The reminder now finds the row already logged for the
// cycle it asks about, names it, and links it on "Already logged": the row gains the item's recurringId and the
// cycle's day as cycleDate (and a new updatedAt). Nothing else on it changes, and nothing new is logged. No new
// field: both are known to every build since Phase 2.5, so an older build reads a linked row as the cycle's payment.
//
// The rule (FIX_PLANS session 63, item 2), for the cycle due on day D of item R. A row matches when it is:
// - live (not deleted, not purged);
// - tied to nothing: no recurringId, no cycleDate at all (a row detached earlier, cycleDate null, is not offered
//   again), no extra payment, debt, goal, foreign cash or transfer-leg link;
// - spending (Needs, Wants or Savings);
// - R's name, trimmed, lower case and spaces collapsed (the bill hints' key), in R's currency (nothing converted);
// - within BILL_BAND (50%) of R's amount;
// - within half a cycle of D, both ends counted (HALF_CYCLE_DAYS).
// Several: the nearest D; on a tie the earlier date, then the earlier createdAt, then the id. The person decides:
// the rule only finds the row to offer, and the link re-checks it.
import { BILL_BAND, billHintKey } from "./billHints";
import { nextConfirmTarget, type Currency, type LocalFinancials, type RecurringFrequency, type StoredRecurring, type StoredTransaction } from "./localData";
import type { CalendarDay } from "./calendarDay";

/** Half a cycle, in days: how far from the due day a row may be dated and still be offered for that cycle. */
export const HALF_CYCLE_DAYS: Record<RecurringFrequency, number> = {
  weekly: 3, biweekly: 7, monthly: 15, every2months: 30, quarterly: 45, biannually: 91, yearly: 182,
};

/** Every sentence the reminder adds (drafted in session 63; approved by the owner, session 64). */
export const LOGGED_TEXT = {
  found: (name: string, date: string, amount: string) => `You logged ${name} on ${date} (${amount}).`,
  already: "Already logged",
  linked: (name: string, date: string) => `${name}: your entry of ${date} now counts as this payment. Nothing new was logged.`,
  undo: "Undo",
} as const;

/** The row found for a renewal's cycle, as the reminder shows it: the row's own words, date, amount and currency. */
export interface LoggedEntry {
  txId: string;
  description: string;
  date: string;
  amount: number;
  currency: Currency;
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

function tiedToNothing(t: StoredTransaction): boolean {
  return t.recurringId == null && t.cycleDate === undefined && t.extraForRecurringId == null
    && t.debtId == null && t.goalId == null && t.fx == null && t.linkedPaymentId == null;
}

/** The row already logged for R's cycle due on `dueISO` (YYYY-MM-DD), or null. */
export function loggedEntryFor(r: StoredRecurring, dueISO: string, transactions: readonly StoredTransaction[]): StoredTransaction | null {
  return findLogged(r, dueISO, transactions, (t) => billHintKey(t.description, t.currency));
}

/**
 * The rule above, for one bill. TODO 127 (owner, session 65): the name key is the costly check (a normalised string),
 * so it comes last, after the amount and the date, and comes from `keyOf`, which loggedEntries shares across the bills
 * of one call. Every check must hold and the tie-break runs only on rows that pass them all, so the order changes the
 * cost, not the answer (alreadyLogged.same-results.test.ts holds it to session 63's rule).
 */
function findLogged(r: StoredRecurring, dueISO: string, transactions: readonly StoredTransaction[], keyOf: (t: StoredTransaction) => string): StoredTransaction | null {
  if (!(r.amount > 0)) return null;
  let key: string | undefined; // the bill's own, built the first time a row needs it
  const due = dayNumber(dueISO);
  const half = HALF_CYCLE_DAYS[r.frequency];
  let best: StoredTransaction | null = null, bestGap = Infinity;
  for (const t of transactions) {
    if (t.deletedAt != null || t.purgedAt != null || !tiedToNothing(t)) continue;
    if (t.bucket !== "NEEDS" && t.bucket !== "WANTS" && t.bucket !== "SAVINGS") continue;
    if (!(t.amount > 0) || Math.abs(t.amount - r.amount) > BILL_BAND * r.amount) continue;
    const gap = Math.abs(dayNumber(t.date) - due);
    if (!(gap <= half)) continue;
    if (keyOf(t) !== (key ??= billHintKey(r.name, r.currency))) continue;
    if (best === null || gap < bestGap || (gap === bestGap && earlier(t, best))) { best = t; bestGap = gap; }
  }
  return best;
}

function earlier(a: StoredTransaction, b: StoredTransaction): boolean {
  if (a.date !== b.date) return a.date < b.date;
  const ac = a.createdAt ?? "", bc = b.createdAt ?? "";
  if (ac !== bc) return ac < bc;
  return a.id < b.id;
}

/**
 * For each renewal the reminder can show, the row found for its cycle (by item id). Called once per render (the page's
 * memo), so each row's name key is built at most once here, for all the renewals (TODO 127).
 */
export function loggedEntries(data: LocalFinancials, renewals: readonly { id: string; dueDate: string }[]): Record<string, LoggedEntry> {
  const out: Record<string, LoggedEntry> = {};
  const keys = new Map<StoredTransaction, string>();
  const keyOf = (t: StoredTransaction) => {
    let k = keys.get(t);
    if (k === undefined) { k = billHintKey(t.description, t.currency); keys.set(t, k); }
    return k;
  };
  for (const n of renewals) {
    const r = (data.recurring ?? []).find((x) => x.id === n.id);
    const t = r ? findLogged(r, n.dueDate, data.transactions ?? [], keyOf) : null;
    if (t) out[n.id] = { txId: t.id, description: t.description.trim(), date: t.date, amount: t.amount, currency: t.currency };
  }
  return out;
}

/**
 * Links the row to R's cycle due on `dueISO`: the row gains `recurringId` and `cycleDate`, and a new `updatedAt`.
 * Null (nothing to store) unless `dueISO` is still the cycle the reminder asks about (R's next confirm target) and the
 * row is still the one the rule offers for it.
 */
export function linkLoggedEntry(data: LocalFinancials, recurringId: string, txId: string, dueISO: string, asOf: CalendarDay, at: string = new Date().toISOString()): LocalFinancials | null {
  const r = (data.recurring ?? []).find((x) => x.id === recurringId);
  if (!r) return null;
  const target = nextConfirmTarget(r, data.transactions, data, asOf);
  if (!target || target.dueDate.toISOString().slice(0, 10) !== dueISO) return null;
  if (loggedEntryFor(r, dueISO, data.transactions)?.id !== txId) return null;
  return { ...data, transactions: data.transactions.map((t) => (t.id !== txId ? t : { ...t, recurringId, cycleDate: dueISO, updatedAt: at })) };
}

/**
 * Undo of a link: deletes `recurringId` and `cycleDate` from the row (the rule only offers rows with neither, so
 * that is their prior state), and writes a newer `updatedAt` (deliberately not the old one: a device that already
 * synced the link would win the merge with it). Null when the row no longer holds the link this undoes.
 */
export function unlinkLoggedEntry(data: LocalFinancials, recurringId: string, txId: string, dueISO: string, at: string = new Date().toISOString()): LocalFinancials | null {
  const row = data.transactions.find((t) => t.id === txId);
  if (!row || row.recurringId !== recurringId || row.cycleDate !== dueISO) return null;
  return {
    ...data,
    transactions: data.transactions.map((t) => {
      if (t.id !== txId) return t;
      const { recurringId: _r, cycleDate: _c, ...rest } = t;
      return { ...rest, updatedAt: at };
    }),
  };
}
