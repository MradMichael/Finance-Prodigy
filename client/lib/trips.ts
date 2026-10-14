// Travel slice 2 (HELD; owner, session 16; FIX_PLANS.md "Slice 2, trips"):
// a trip has a name, dates and a budget in USD, optionally per category. Rows
// are tagged to it by `tripId`. Deleting a trip keeps its tags (owner,
// approved): a tag with no trip counts nowhere.
// Foreign cash, model 2 (session 18): planned against actual, in USD, each
// row converted as every spending figure is (toUSDForMonth: a lira row at its
// period's rate):
//   + the trip's tagged NEEDS, WANTS and SAVINGS rows, an exchange included
//     (a Wants row for what was paid);
//   - its tagged INCOME rows (euros changed back, any refund: decision 3);
//   - its tagged reimbursements (a TRANSFER that gained money and isn't one
//     leg of a transfer);
// and nothing for a transfer's legs. Euro spends never reach the USD figure;
// the card shows them in euros, by category (tripForeignSpends).
// Units (2.4.138): every `…USD` figure is USD; tripForeignSpends' amounts are
// in their currency `code`.
import { activeTransactions, makeToUSDOn, recordDeletion, uid, type LocalFinancials, type StoredTransaction } from "./localData";

export interface StoredTrip {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD, local
  endDate: string;   // YYYY-MM-DD, local, on or after startDate
  /** The whole trip's budget, USD. */
  budgetUSD: number;
  /** Optional budgets by category key, USD. */
  categoryBudgetsUSD?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const SPENDING = new Set(["NEEDS", "WANTS", "SAVINGS"]);

/** A new trip, checked: a name, dates in order, budgets that aren't negative. */
export function buildTrip(p: { name: string; startDate: string; endDate: string; budgetUSD: number; categoryBudgetsUSD?: Record<string, number> }, now: Date = new Date()):
  { ok: true; trip: StoredTrip } | { ok: false; reason: "name" | "dates" | "budget" } {
  const name = p.name.trim();
  if (!name) return { ok: false, reason: "name" };
  if (!p.startDate || !p.endDate || p.endDate < p.startDate) return { ok: false, reason: "dates" };
  const budgets = Object.values(p.categoryBudgetsUSD ?? {});
  if (!(p.budgetUSD >= 0) || budgets.some((b) => !(b >= 0))) return { ok: false, reason: "budget" };
  const at = now.toISOString();
  return {
    ok: true,
    trip: {
      id: uid(), name, startDate: p.startDate, endDate: p.endDate, budgetUSD: round2(p.budgetUSD),
      ...(budgets.length ? { categoryBudgetsUSD: Object.fromEntries(Object.entries(p.categoryBudgetsUSD!).map(([k, v]) => [k, round2(v)])) } : {}),
      createdAt: at, updatedAt: at,
    },
  };
}

/**
 * A trip edited (session 17): checked as a new trip is. Its id and creation
 * time stay and its edit time moves, so the sync merge sees an ordinary
 * change. Rows aren't touched, so every tag stays. A trip that's gone
 * (deleted on another device) isn't brought back.
 */
export function editTrip(data: LocalFinancials, tripId: string, p: Parameters<typeof buildTrip>[0], now: Date = new Date()):
  { ok: true; data: LocalFinancials } | { ok: false; reason: "name" | "dates" | "budget" } {
  const old = (data.trips ?? []).find((t) => t.id === tripId);
  if (!old) return { ok: true, data };
  const r = buildTrip(p, now);
  if (!r.ok) return r;
  const { id: _new, createdAt: _created, ...fields } = r.trip;
  const trip: StoredTrip = { id: old.id, ...fields, createdAt: old.createdAt };
  return { ok: true, data: { ...data, trips: (data.trips ?? []).map((t) => (t.id === tripId ? trip : t)) } };
}

/**
 * The trip whose dates hold `date` (start and end included), for a form's
 * default. `orNext` (an exchange, decision 10): failing that, the next trip
 * starting after it, since euros are usually bought before leaving.
 */
export function suggestedTripId(trips: StoredTrip[], date: string, { orNext = false }: { orNext?: boolean } = {}): string | undefined {
  const holding = trips.filter((t) => t.startDate <= date && date <= t.endDate).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (holding || !orNext) return holding?.id;
  return trips.filter((t) => t.startDate > date).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]?.id;
}

/** A reimbursement: a TRANSFER that gained money and isn't one leg of a transfer (no other TRANSFER shares its link). */
export function isReimbursement(t: StoredTransaction, all: StoredTransaction[]): boolean {
  if (t.bucket !== "TRANSFER" || !(t.amount > 0)) return false;
  return !(t.linkedPaymentId && all.some((o) => o.id !== t.id && o.bucket === "TRANSFER" && o.linkedPaymentId === t.linkedPaymentId));
}

/** The trip's actual in USD, in total and by category ("" for none), and the rows counted. */
export function tripActual(data: LocalFinancials, trip: StoredTrip): { totalUSD: number; byCategoryUSD: Record<string, number>; rows: StoredTransaction[] } {
  const toUSD = makeToUSDOn(data); // plan J (held): each row at its own day's rate
  const all = data.transactions ?? [];
  const sign = (t: StoredTransaction) => (SPENDING.has(t.bucket) ? 1 : t.bucket === "INCOME" || isReimbursement(t, all) ? -1 : 0);
  const rows = activeTransactions(all).filter((t) => t.tripId === trip.id && sign(t) !== 0);
  const byCategoryUSD: Record<string, number> = {};
  let total = 0;
  for (const t of rows) {
    const usd = sign(t) * toUSD(t.amount, t.currency, t.date);
    total += usd;
    byCategoryUSD[t.category ?? ""] = round2((byCategoryUSD[t.category ?? ""] ?? 0) + usd);
  }
  return { totalUSD: round2(total), byCategoryUSD, rows };
}

/** The trip's euro spends (sheet entries tagged to it), by currency: the total and each category ("" for none). For information only. */
export function tripForeignSpends(data: LocalFinancials, trip: StoredTrip): { code: string; amount: number; byCategory: Record<string, number> }[] {
  const by = new Map<string, { code: string; amount: number; byCategory: Record<string, number> }>();
  for (const e of (data.foreignEntries ?? []).filter((x) => x.kind === "spend" && x.tripId === trip.id)) {
    const s = by.get(e.code) ?? { code: e.code, amount: 0, byCategory: {} };
    s.amount = round2(s.amount + e.amount);
    s.byCategory[e.category ?? ""] = round2((s.byCategory[e.category ?? ""] ?? 0) + e.amount);
    by.set(e.code, s);
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Deletes a trip, recording the deletion so other devices drop it too. Its rows keep their tags. */
export function deleteTrip(data: LocalFinancials, tripId: string, now: Date = new Date()): LocalFinancials {
  return { ...data, trips: (data.trips ?? []).filter((t) => t.id !== tripId), deletedKeys: recordDeletion(data, "trips", tripId, now) };
}
