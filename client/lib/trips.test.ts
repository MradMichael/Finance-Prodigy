// Travel slice 2 (HELD; owner, session 16; FIX_PLANS.md "Slice 2, trips"):
// a trip has a name, dates and a budget in USD, optionally per category.
// Rows are tagged to it (`tripId`). Deleting a trip keeps its tags; a tag
// with no trip is ignored.
// Foreign cash, model 2 (session 18): planned against actual, in USD:
//   + the trip's tagged NEEDS, WANTS and SAVINGS rows, an exchange included
//     (it's a Wants row: what was paid), a lira row at its period's rate;
//   - its tagged INCOME rows (euros changed back, any refund; decision 3);
//   - its tagged reimbursements: a TRANSFER row that gained money and isn't
//     one leg of a transfer;
//   and nothing for a transfer's legs or for euro spends. Each row counts
//   under its own category. The card also shows the trip's euro spends, in
//   euros, by category, never added to the USD figure.
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, softDelete, isEmptyFinancials, buildTransferTx, type LocalFinancials, type StoredTransaction } from "./localData";
import { buildExchange, buildChangeBack, buildForeignEntry } from "./foreignCash";
import { buildTrip, editTrip, tripActual, tripForeignSpends, suggestedTripId, deleteTrip, type StoredTrip } from "./trips";

const RATE = 89_500;
const LISBON: StoredTrip = { id: "trip-lis", name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200, categoryBudgetsUSD: { dining: 400, transport: 150 }, createdAt: "2026-10-12T09:00:00.000Z", updatedAt: "2026-10-12T09:00:00.000Z" };
const data = (transactions: StoredTransaction[], trips: StoredTrip[] = [LISBON], extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, lbpRate: RATE, lbpRateHistory: [], transactions, trips, ...extra }) as LocalFinancials;
const row = (id: string, amount: number, extra: Partial<StoredTransaction> = {}): StoredTransaction =>
  ({ id, amount, currency: "USD", bucket: "WANTS", description: id, date: "2026-11-03", ...extra }) as StoredTransaction;
const CASH = { paymentMethod: "cash" as const };
const at = (iso: string) => new Date(iso);

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

  it("for an exchange (decision 10): else the next trip starting after the date, since euros are bought before leaving", () => {
    const rome: StoredTrip = { ...LISBON, id: "trip-rome", name: "Rome", startDate: "2026-12-01", endDate: "2026-12-05" };
    expect(suggestedTripId([rome, LISBON], "2026-10-20", { orNext: true })).toBe("trip-lis");
    expect(suggestedTripId([rome, LISBON], "2026-11-04", { orNext: true })).toBe("trip-lis");
    expect(suggestedTripId([rome, LISBON], "2026-11-20", { orNext: true })).toBe("trip-rome");
    expect(suggestedTripId([rome, LISBON], "2026-12-20", { orNext: true })).toBeUndefined();
    expect(suggestedTripId([rome, LISBON], "2026-10-20")).toBeUndefined();
  });
});

describe("planned against actual, in USD", () => {
  it("the worked example: $500 → €460 tagged; a €40 dinner on the sheet; €100 changed back for $105; a friend repays $20", () => {
    const exch = { ...buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: CASH, code: "EUR", received: 460, description: "Exchange to EUR" }, RATE), tripId: "trip-lis" };
    const dinner = buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-11-03", description: "Dinner", category: "dining", tripId: "trip-lis" }, at("2026-11-03T20:00:00.000Z"));
    const back = { ...buildChangeBack({ date: "2026-11-12", code: "EUR", given: 100, received: 105, receivedCurrency: "USD", to: CASH, description: "Changed back from EUR" }, RATE), tripId: "trip-lis" };
    const repaid = row("repaid", 20, { bucket: "TRANSFER", paymentMethod: "cash", tripId: "trip-lis" });
    expect(tripActual(data([exch]), LISBON).totalUSD).toBe(500);
    expect(tripActual(data([exch], [LISBON], { foreignEntries: [dinner] }), LISBON).totalUSD).toBe(500);
    expect(tripActual(data([exch, back], [LISBON], { foreignEntries: [dinner] }), LISBON).totalUSD).toBe(395);
    const a = tripActual(data([exch, back, repaid], [LISBON], { foreignEntries: [dinner] }), LISBON);
    expect(a.totalUSD).toBe(375);
    expect(a.byCategoryUSD).toEqual({ travel: 395, "": -20 });
  });

  it("tagged spends count in USD (lira at the period's rate) under their own category", () => {
    const a = tripActual(data([row("taxi", 30, { category: "transport", tripId: "trip-lis" }), row("museum", 1_790_000, { currency: "LBP", tripId: "trip-lis" })]), LISBON);
    expect(a.totalUSD).toBe(50); // 30 + L£1,790,000 at 89,500
    expect(a.byCategoryUSD).toEqual({ transport: 30, "": 20 });
  });

  it("a tagged refund logged as income lowers the trip under its own category (decision 3)", () => {
    const a = tripActual(data([row("hotel", 300, { category: "lodging", tripId: "trip-lis" }), row("hotel refund", 50, { bucket: "INCOME", category: "lodging", tripId: "trip-lis" })]), LISBON);
    expect(a.totalUSD).toBe(250);
    expect(a.byCategoryUSD).toEqual({ lodging: 250 });
  });

  it("an ordinary transfer's legs count for nothing, tagged or not; a reimbursement is a lone transfer that gained money", () => {
    const legs = buildTransferTx(200, "USD", { paymentMethod: "card", label: "Card" }, { paymentMethod: "cash", label: "Cash" }, RATE, { date: "2026-11-03" }).map((t) => ({ ...t, tripId: "trip-lis" }));
    const lost = row("lost", 15, { bucket: "TRANSFER", amount: -15, tripId: "trip-lis" }); // a lone transfer that LOST money isn't a reimbursement
    expect(tripActual(data([row("dinner", 60, { tripId: "trip-lis" }), ...legs, lost]), LISBON).totalUSD).toBe(60);
  });

  it("leaves out deleted rows, rows tagged to another trip, and untagged rows", () => {
    const d = data([
      row("in-trip", 50, { tripId: "trip-lis" }),
      softDelete(data([]), row("deleted", 70, { tripId: "trip-lis" }), "2026-11-04T00:00:00.000Z"),
      row("other-trip", 90, { tripId: "trip-other" }),
      row("untagged", 11),
    ]);
    expect(tripActual(d, LISBON).totalUSD).toBe(50);
  });

  it("the rows it lists are the ones it counts", () => {
    const d = data([row("in-trip", 50, { tripId: "trip-lis" }), row("refund", 5, { bucket: "INCOME", tripId: "trip-lis" }), row("untagged", 11)]);
    expect(tripActual(d, LISBON).rows.map((t) => t.id)).toEqual(["in-trip", "refund"]);
  });
});

describe("the trip's euro spends (for information)", () => {
  it("by currency: the total and each category, from the sheet's spends tagged to it", () => {
    const e = (amount: number, category: string | undefined, tripId: string | undefined, kind: "spend" | "in" = "spend") =>
      buildForeignEntry({ kind, code: "EUR", amount, date: "2026-11-03", description: "x", ...(category ? { category } : {}), ...(tripId ? { tripId } : {}) }, at("2026-11-03T09:00:00.000Z"));
    const d = data([], [LISBON], { foreignEntries: [e(40, "dining", "trip-lis"), e(15, "transport", "trip-lis"), e(5, undefined, "trip-lis"), e(99, "dining", undefined), e(20, undefined, "trip-lis", "in")] });
    expect(tripForeignSpends(d, LISBON)).toEqual([{ code: "EUR", amount: 60, byCategory: { dining: 40, transport: 15, "": 5 } }]);
    expect(tripForeignSpends(data([]), LISBON)).toEqual([]);
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

it("an account holding only a trip, or only a sheet entry, isn't empty (so a restore asks before replacing it)", () => {
  expect(isEmptyFinancials(data([], [LISBON]))).toBe(false);
  expect(isEmptyFinancials(data([], [], { foreignEntries: [buildForeignEntry({ kind: "in", code: "EUR", amount: 20, date: "2026-11-03", description: "x" }, at("2026-11-03T09:00:00.000Z"))] }))).toBe(false);
  expect(isEmptyFinancials(data([], []))).toBe(true);
});
