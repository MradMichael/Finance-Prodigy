// Travel slice 2 (HELD; owner, session 16; FIX_PLANS.md "Slice 2, trips"):
// a trip has a name, dates and a budget in USD, optionally per category.
// Rows are tagged to it (`tripId`); an exchange's two rows are tagged together.
// Planned against actual, in USD at cost: the trip's tagged NEEDS, WANTS and
// SAVINGS rows (a pocket spend at its frozen cost, a lira row at its period's
// rate). Exchanges and income aren't spending; a tagged exchange shows as the
// trip's foreign cash bought. Deleting a trip keeps its tags; a tag with no
// trip is ignored.
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, softDelete, isEmptyFinancials, type LocalFinancials, type StoredTransaction } from "./localData";
import { buildExchange, buildPocketSpend } from "./foreignCash";
import { buildTrip, editTrip, tripActual, tripCashBought, suggestedTripId, tagRows, deleteTrip, type StoredTrip } from "./trips";

const RATE = 89_500;
const LISBON: StoredTrip = { id: "trip-lis", name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200, categoryBudgetsUSD: { dining: 400, transport: 150 }, createdAt: "2026-10-12T09:00:00.000Z", updatedAt: "2026-10-12T09:00:00.000Z" };
const data = (transactions: StoredTransaction[], trips: StoredTrip[] = [LISBON], extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, lbpRate: RATE, lbpRateHistory: [], transactions, trips, ...extra }) as LocalFinancials;
const row = (id: string, amount: number, extra: Partial<StoredTransaction> = {}): StoredTransaction =>
  ({ id, amount, currency: "USD", bucket: "WANTS", description: id, date: "2026-11-03", ...extra }) as StoredTransaction;

describe("a trip", () => {
  it("needs a name, dates in order, and a budget that isn't negative; category budgets likewise", () => {
    expect(buildTrip({ name: "  Lisbon ", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200 })).toMatchObject({ ok: true, trip: { name: "Lisbon", budgetUSD: 1200 } });
    expect(buildTrip({ name: "", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200 })).toEqual({ ok: false, reason: "name" });
    expect(buildTrip({ name: "Lisbon", startDate: "2026-11-09", endDate: "2026-11-02", budgetUSD: 1200 })).toEqual({ ok: false, reason: "dates" });
    expect(buildTrip({ name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: -1 })).toEqual({ ok: false, reason: "budget" });
    expect(buildTrip({ name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 100, categoryBudgetsUSD: { dining: -5 } })).toEqual({ ok: false, reason: "budget" });
    expect(buildTrip({ name: "Day trip", startDate: "2026-11-02", endDate: "2026-11-02", budgetUSD: 0 }).ok).toBe(true); // one day, no budget yet
  });

  it("the suggested trip for a date is the one whose dates hold it, start and end included", () => {
    expect(suggestedTripId([LISBON], "2026-11-02")).toBe("trip-lis");
    expect(suggestedTripId([LISBON], "2026-11-09")).toBe("trip-lis");
    expect(suggestedTripId([LISBON], "2026-11-10")).toBeUndefined();
    expect(suggestedTripId([], "2026-11-03")).toBeUndefined();
  });
});

describe("planned against actual, in USD at cost", () => {
  it("sums the trip's spending: dollars as they are, a pocket spend at its frozen cost, lira at the period's rate", () => {
    const exch = buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, RATE);
    const pocketSpend = { ...buildPocketSpend({ date: "2026-11-03", code: "EUR", amount: 40, bucket: "WANTS", category: "dining", description: "Dinner", costPerUnitUSD: 500 / 460 }), tripId: "trip-lis" };
    const d = data([
      ...exch.map((t) => ({ ...t, tripId: "trip-lis" })),
      pocketSpend,
      row("taxi", 30, { category: "transport", tripId: "trip-lis" }),
      row("museum", 1_790_000, { currency: "LBP", tripId: "trip-lis" }), // L£1,790,000 at 89,500 = $20
    ]);
    const a = tripActual(d, LISBON);
    expect(a.totalUSD).toBe(93.48); // 43.48 + 30 + 20; the exchange isn't spending
    expect(a.byCategoryUSD).toEqual({ dining: 43.48, transport: 30, "": 20 });
  });

  it("leaves out income, transfers, deleted rows, rows tagged to another trip, and untagged rows", () => {
    const d = data([
      row("in-trip", 50, { tripId: "trip-lis" }),
      row("refund", 25, { bucket: "INCOME", tripId: "trip-lis" }),
      row("repaid", 40, { bucket: "TRANSFER", tripId: "trip-lis" }), // a reimbursement: a transfer, not spending
      softDelete(data([]), row("deleted", 70, { tripId: "trip-lis" }), "2026-11-04T00:00:00.000Z"),
      row("other-trip", 90, { tripId: "trip-other" }),
      row("untagged", 11),
    ]);
    expect(tripActual(d, LISBON).totalUSD).toBe(50);
  });

  it("the trip's foreign cash bought: its tagged exchanges, by currency, with what they cost", () => {
    const exch = buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, RATE);
    expect(tripCashBought(data(exch.map((t) => ({ ...t, tripId: "trip-lis" }))), LISBON)).toEqual([{ code: "EUR", amount: 460, costUSD: 500 }]);
    expect(tripCashBought(data(exch), LISBON)).toEqual([]);
  });
});

describe("tagging", () => {
  it("tags a row; an exchange's two rows are tagged together; untagging clears both", () => {
    const [src, pocket] = buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, RATE);
    const other = row("x", 5);
    const tagged = tagRows([src, pocket, other], src.id, "trip-lis", "2026-10-12T10:00:00.000Z");
    expect(tagged.filter((t) => t.tripId === "trip-lis").map((t) => t.id).sort()).toEqual([src.id, pocket.id].sort());
    expect(tagged.find((t) => t.id === pocket.id)!.updatedAt).toBe("2026-10-12T10:00:00.000Z");
    expect(tagged.find((t) => t.id === "x")).toEqual(other);
    const untagged = tagRows(tagged, pocket.id, undefined, "2026-10-12T11:00:00.000Z");
    expect(untagged.filter((t) => t.tripId).length).toBe(0);
  });
});

// Session 17, item 2: a trip's name, dates, budget and category budgets can be
// edited. Its id and creation time stay, its edit time moves (so the sync
// merge sees an ordinary change), and the rows aren't touched: every tag stays.
describe("editing a trip", () => {
  const p = { name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200 };

  it("changes its name, dates, budget and category budgets; keeps its id, its creation time and every tag", () => {
    const d = data([row("taxi", 30, { category: "transport", tripId: "trip-lis" })]);
    const r = editTrip(d, "trip-lis", { name: " Lisbon and Porto ", startDate: "2026-11-01", endDate: "2026-11-12", budgetUSD: 1500, categoryBudgetsUSD: { dining: 500, lodging: 600 } }, new Date("2026-10-20T08:00:00.000Z"));
    if (!r.ok) throw new Error("refused");
    expect(r.data.trips).toEqual([{ id: "trip-lis", name: "Lisbon and Porto", startDate: "2026-11-01", endDate: "2026-11-12", budgetUSD: 1500, categoryBudgetsUSD: { dining: 500, lodging: 600 }, createdAt: LISBON.createdAt, updatedAt: "2026-10-20T08:00:00.000Z" }]);
    expect(r.data.transactions).toBe(d.transactions); // the rows aren't touched
  });

  it("removing every category budget leaves none", () => {
    const r = editTrip(data([]), "trip-lis", p);
    if (!r.ok) throw new Error("refused");
    expect(r.data.trips![0]).not.toHaveProperty("categoryBudgetsUSD");
  });

  it("is refused for the same reasons as a new trip", () => {
    expect(editTrip(data([]), "trip-lis", { ...p, name: " " })).toEqual({ ok: false, reason: "name" });
    expect(editTrip(data([]), "trip-lis", { ...p, endDate: "2026-11-01" })).toEqual({ ok: false, reason: "dates" });
    expect(editTrip(data([]), "trip-lis", { ...p, budgetUSD: -1 })).toEqual({ ok: false, reason: "budget" });
  });

  it("leaves other trips alone, and doesn't bring back a trip that's gone", () => {
    const rome: StoredTrip = { ...LISBON, id: "trip-rome", name: "Rome" };
    const r = editTrip(data([], [LISBON, rome]), "trip-lis", { ...p, budgetUSD: 900 });
    if (!r.ok) throw new Error("refused");
    expect(r.data.trips!.find((t) => t.id === "trip-rome")).toEqual(rome);
    const gone = data([], [rome]);
    expect(editTrip(gone, "trip-lis", p)).toEqual({ ok: true, data: gone });
  });
});

describe("deleting a trip", () => {
  it("removes it and records the deletion; its rows keep their tags; a tag with no trip counts nowhere", () => {
    const d = data([row("taxi", 30, { tripId: "trip-lis" })]);
    const out = deleteTrip(d, "trip-lis", new Date("2026-11-20T00:00:00.000Z"));
    expect(out.trips).toEqual([]);
    expect(out.deletedKeys?.trips?.map((t) => t.key)).toEqual(["trip-lis"]);
    expect(out.transactions[0].tripId).toBe("trip-lis");
  });
});

it("an account holding only a trip isn't empty (so a restore asks before replacing it)", () => {
  expect(isEmptyFinancials(data([], [LISBON]))).toBe(false);
  expect(isEmptyFinancials(data([], []))).toBe(true);
});
