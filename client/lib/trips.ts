// Travel slice 2 (HELD; owner, session 16; FIX_PLANS.md "Slice 2, trips"):
// a trip has a name, dates and a budget in USD, optionally per category. Rows
// are tagged to it by `tripId`; an exchange's two rows are tagged together, as
// they're deleted together. Planned against actual, in USD at cost: the trip's
// tagged NEEDS, WANTS and SAVINGS rows, each converted as every spending
// figure is (toUSDForMonth: a pocket spend is already USD at its frozen cost,
// a lira row at its period's rate). Exchanges and income aren't spending; a
// tagged exchange shows as the trip's foreign cash bought. Deleting a trip
// keeps its tags (owner, approved): a tag with no trip counts nowhere.
// Units (2.4.138): every `…USD` figure is USD; `amount` in tripCashBought is
// in its currency `code`.
import { activeTransactions, cycleStartDayOf, makeToUSDForMonth, recordDeletion, uid, type LocalFinancials, type StoredTransaction } from "./localData";
import { cycleKeyForISO } from "./period";
import { pairedIds } from "./foreignCash";

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

/** The trip whose dates hold `date` (start and end included), for a form's default. */
export function suggestedTripId(trips: StoredTrip[], date: string): string | undefined {
  return trips.filter((t) => t.startDate <= date && date <= t.endDate).sort((a, b) => b.startDate.localeCompare(a.startDate))[0]?.id;
}

/** The trip's spending in USD at cost, in total and by category ("" for none). */
export function tripActual(data: LocalFinancials, trip: StoredTrip): { totalUSD: number; byCategoryUSD: Record<string, number>; rows: StoredTransaction[] } {
  const toUSD = makeToUSDForMonth(data);
  const startDay = cycleStartDayOf(data);
  const rows = activeTransactions(data.transactions ?? []).filter((t) => t.tripId === trip.id && SPENDING.has(t.bucket));
  const byCategoryUSD: Record<string, number> = {};
  let total = 0;
  for (const t of rows) {
    const usd = toUSD(t.amount, t.currency, cycleKeyForISO(t.date, startDay));
    total += usd;
    byCategoryUSD[t.category ?? ""] = round2((byCategoryUSD[t.category ?? ""] ?? 0) + usd);
  }
  return { totalUSD: round2(total), byCategoryUSD, rows };
}

/** The trip's foreign cash bought: its tagged exchanges' pocket legs, by currency, with their USD cost. */
export function tripCashBought(data: LocalFinancials, trip: StoredTrip): { code: string; amount: number; costUSD: number }[] {
  const toUSD = makeToUSDForMonth(data);
  const startDay = cycleStartDayOf(data);
  const by = new Map<string, { code: string; amount: number; costUSD: number }>();
  for (const t of activeTransactions(data.transactions ?? []).filter((x) => x.tripId === trip.id && x.fx?.kind === "in")) {
    const e = by.get(t.fx!.code) ?? { code: t.fx!.code, amount: 0, costUSD: 0 };
    e.amount = round2(e.amount + t.fx!.amount);
    e.costUSD = round2(e.costUSD + toUSD(t.amount, t.currency, cycleKeyForISO(t.date, startDay)));
    by.set(t.fx!.code, e);
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Tags a row to a trip (or clears its tag); an exchange's two rows go together. */
export function tagRows(transactions: StoredTransaction[], id: string, tripId: string | undefined, at: string): StoredTransaction[] {
  const ids = new Set(pairedIds(transactions, id));
  return transactions.map((t) => {
    if (!ids.has(t.id)) return t;
    const { tripId: _old, ...rest } = t;
    return { ...rest, ...(tripId ? { tripId } : {}), updatedAt: at };
  });
}

/** Deletes a trip, recording the deletion so other devices drop it too. Its rows keep their tags. */
export function deleteTrip(data: LocalFinancials, tripId: string, now: Date = new Date()): LocalFinancials {
  return { ...data, trips: (data.trips ?? []).filter((t) => t.id !== tripId), deletedKeys: recordDeletion(data, "trips", tripId, now) };
}
