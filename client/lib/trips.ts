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
import { activeTransactions, edited, makeToUSDOn, recordDeletion, uid, TRAVEL_CATEGORY_KEYS, type LocalFinancials, type StoredTransaction } from "./localData";

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
  const toUSD = makeToUSDOn(data); // plan J (merged in session 23, bafa688): each row at its own day's rate
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

// ── Session 22, items 1c and 1d (owner; approved and merged in session 23, 2f5d30c) ──────────────────────────────

/**
 * The spends dated inside the trip (start and end included) that carry no
 * trip tag, or a tag to a trip that's gone (it counts nowhere): NEEDS, WANTS
 * or SAVINGS rows, never income, a transfer or an exchange. Oldest first.
 */
export function untaggedDuringTrip(data: LocalFinancials, trip: StoredTrip): StoredTransaction[] {
  const trips = new Set((data.trips ?? []).map((t) => t.id));
  return activeTransactions(data.transactions ?? [])
    .filter((t) => SPENDING.has(t.bucket) && t.fx?.kind !== "exchange" && !(t.tripId && trips.has(t.tripId)) && t.date >= trip.startDate && t.date <= trip.endDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** One row tagged to a trip: the person's edit to it, stamped (plan H 5b), so a merge keeps it. */
export function tagToTrip(data: LocalFinancials, transactionId: string, tripId: string, now: Date = new Date()): LocalFinancials {
  return { ...data, transactions: (data.transactions ?? []).map((t) => (t.id === transactionId ? edited({ ...t, tripId }, now.toISOString()) : t)) };
}

/** The trip's average exchange cost per currency: dollars paid over units received, across its tagged exchanges. */
export function tripExchangeCost(data: LocalFinancials, trip: StoredTrip): Record<string, number> {
  const toUSD = makeToUSDOn(data); // each exchange at its own day's rate (plan J; owner, session 23)
  const paid: Record<string, number> = {}, got: Record<string, number> = {};
  for (const t of activeTransactions(data.transactions ?? []).filter((x) => x.tripId === trip.id && x.fx?.kind === "exchange")) {
    const code = t.fx!.code;
    paid[code] = (paid[code] ?? 0) + toUSD(t.amount, t.currency, t.date);
    got[code] = (got[code] ?? 0) + t.fx!.amount;
  }
  return Object.fromEntries(Object.keys(paid).filter((c) => got[c] > 0).map((c) => [c, paid[c] / got[c]]));
}

export interface TripCategoryRow {
  key: string; // a category key; "" for none
  /** Dollars counted: the trip's tagged USD and LBP spends in this category, at their rate, net of its refunds. */
  countedUSD: number;
  /** Cash spent in another currency, shown, never added; approxUSD at the trip's exchange cost (null with no exchange in that currency). */
  fromCash: { code: string; amount: number; approxUSD: number | null }[];
  budgetUSD?: number;
  /** What the budget is compared against: counted dollars plus the cash at ≈ its exchange cost. Never part of the trip total. */
  comparedUSD: number;
}

/**
 * The trip by category: one row per category with money or a budget, travel
 * categories first in the pickers' order, then the others. The exchanges and
 * change-backs (the money moving) count in the total and in no row. The
 * total is tripActual's, unchanged: exchanges + tagged spends − tagged
 * refunds and change-backs.
 */
export function tripCategoryView(data: LocalFinancials, trip: StoredTrip): { rows: TripCategoryRow[]; exchangesUSD: number; totalUSD: number } {
  const actual = tripActual(data, trip);
  const toUSD = makeToUSDOn(data); // as tripActual counts them (plan J; owner, session 23)
  const sign = (t: StoredTransaction) => (SPENDING.has(t.bucket) ? 1 : -1);
  const counted: Record<string, number> = {};
  let exchanges = 0;
  for (const t of actual.rows) {
    const usd = sign(t) * toUSD(t.amount, t.currency, t.date);
    if (t.fx?.kind === "exchange" || t.fx?.kind === "back") exchanges += usd;
    else counted[t.category ?? ""] = (counted[t.category ?? ""] ?? 0) + usd;
  }
  const cost = tripExchangeCost(data, trip);
  const cash: Record<string, { code: string; amount: number }[]> = {};
  for (const e of tripForeignSpends(data, trip)) for (const [k, v] of Object.entries(e.byCategory)) (cash[k] ??= []).push({ code: e.code, amount: v });
  const budgets = trip.categoryBudgetsUSD ?? {};
  const seen = [...Object.keys(counted), ...Object.keys(cash), ...Object.keys(budgets)];
  const travel = TRAVEL_CATEGORY_KEYS.filter((k) => seen.includes(k));
  const others = [...new Set(seen.filter((k) => !(TRAVEL_CATEGORY_KEYS as readonly string[]).includes(k) && k !== ""))];
  const keys = [...travel, ...others, ...(seen.includes("") ? [""] : [])];
  const rows = keys.map((key): TripCategoryRow => {
    const fromCash = (cash[key] ?? []).map((c) => ({ ...c, approxUSD: cost[c.code] !== undefined ? round2(c.amount * cost[c.code]) : null }));
    const countedUSD = round2(counted[key] ?? 0);
    return {
      key, countedUSD, fromCash,
      ...(budgets[key] !== undefined ? { budgetUSD: budgets[key] } : {}),
      comparedUSD: round2(countedUSD + fromCash.reduce((s2, c) => s2 + (c.approxUSD ?? 0), 0)),
    };
  });
  return { rows, exchangesUSD: round2(exchanges), totalUSD: actual.totalUSD };
}
