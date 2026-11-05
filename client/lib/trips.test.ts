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
import { buildTrip, editTrip, defaultTripName, tripActual, tripForeignSpends, suggestedTripId, deleteTrip, type StoredTrip } from "./trips";

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

  // Travel map plan, Phase 0 (owner-approved): a field the edit form doesn't set (a newer
  // version's cities and notes, say) stays through an edit. It used to be dropped: the trip was
  // rebuilt from the form's fields only, so a device on this code would wipe what newer code wrote.
  it("keeps a field this code doesn't set; the fields it sets are still replaced", () => {
    const newer = { ...LISBON, stops: [{ id: "s1", countryCode: "PT", city: "Lisbon" }], notes: "Fado night" } as StoredTrip;
    const r = editTrip(data([], [newer]), "trip-lis", { ...p, name: "Lisbon and Porto" }, new Date("2026-10-20T08:00:00.000Z"));
    if (!r.ok) throw new Error("refused");
    expect(r.data.trips).toEqual([{
      id: "trip-lis", name: "Lisbon and Porto", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200,
      createdAt: LISBON.createdAt, updatedAt: "2026-10-20T08:00:00.000Z",
      stops: [{ id: "s1", countryCode: "PT", city: "Lisbon" }], notes: "Fado night",
    }]); // categoryBudgetsUSD is a field the form sets: cleared there, so gone here
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

// Travel map plan, Phase 1a (owner-approved): a trip's countries and cities (`stops`, in route
// order) and its notes. A stop is a country (ISO 3166-1 alpha-2, Kosovo XK), optionally a city
// and its coordinates (WGS84 degrees, both or neither). A trip with no stops is still a trip.
describe("a trip's countries, cities and notes", () => {
  const base = { name: "Europe", startDate: "2025-06-01", endDate: "2025-06-20", budgetUSD: 0 };
  const built = (p: Partial<Parameters<typeof buildTrip>[0]>) => buildTrip({ ...base, ...p });
  const stopsOf = (r: ReturnType<typeof buildTrip>) => (r.ok ? r.trip.stops?.map(({ id: _id, ...s }) => s) : r.reason);

  it("keeps stops in route order, each with an id; a city's name is trimmed, and an empty one is none", () => {
    const r = built({ stops: [{ countryCode: "FR", city: " Paris ", lat: 48.85, lon: 2.35 }, { countryCode: "IT", city: "Rome" }, { countryCode: "MT", city: "  " }] });
    expect(stopsOf(r)).toEqual([{ countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 }, { countryCode: "IT", city: "Rome" }, { countryCode: "MT" }]);
    if (!r.ok) throw new Error("refused");
    expect(r.trip.stops!.every((s) => typeof s.id === "string" && s.id.length > 0)).toBe(true);
    expect(new Set(r.trip.stops!.map((s) => s.id)).size).toBe(3);
  });

  it("keeps a stop's id when it has one", () => {
    const r = built({ stops: [{ id: "s-paris", countryCode: "FR", city: "Paris" }] });
    expect(r.ok && r.trip.stops![0].id).toBe("s-paris");
  });

  it("drops a country named again without a city; a country named twice with cities keeps both", () => {
    expect(stopsOf(built({ stops: [{ countryCode: "FR", city: "Paris" }, { countryCode: "FR" }, { countryCode: "IT" }, { countryCode: "IT" }, { countryCode: "FR", city: "Lyon" }] })))
      .toEqual([{ countryCode: "FR", city: "Paris" }, { countryCode: "IT" }, { countryCode: "FR", city: "Lyon" }]);
  });

  it("reads a country code in any case, with spaces", () => {
    expect(stopsOf(built({ stops: [{ countryCode: " lb ", city: "Batroun" }] }))).toEqual([{ countryCode: "LB", city: "Batroun" }]);
  });

  it("refuses a country it doesn't know, and coordinates out of range, unpaired or not numbers", () => {
    for (const s of [
      { countryCode: "ZZ" }, { countryCode: "" }, { countryCode: "FRA" },
      { countryCode: "FR", lat: 91, lon: 0 }, { countryCode: "FR", lat: 0, lon: -181 },
      { countryCode: "FR", lat: 48.85 }, { countryCode: "FR", lon: 2.35 },
      { countryCode: "FR", lat: Number.NaN, lon: 2 }, { countryCode: "FR", lat: 1, lon: Number.POSITIVE_INFINITY },
    ]) expect(built({ stops: [s] }), JSON.stringify(s)).toEqual({ ok: false, reason: "stops" });
    expect(stopsOf(built({ stops: [{ countryCode: "XK", city: "Pristina", lat: 90, lon: -180 }] }))).toEqual([{ countryCode: "XK", city: "Pristina", lat: 90, lon: -180 }]);
  });

  it("no stops, or an empty list, is a trip without any (as every trip before this)", () => {
    for (const r of [built({}), built({ stops: [] })]) {
      if (!r.ok) throw new Error("refused");
      expect(r.trip).not.toHaveProperty("stops");
    }
  });

  it("keeps notes trimmed; empty notes are none", () => {
    const r = built({ notes: "  Fado night in Alfama \n" });
    expect(r.ok && r.trip.notes).toBe("Fado night in Alfama");
    const none = built({ notes: "   " });
    expect(none.ok && none.trip).not.toHaveProperty("notes");
  });

  // Owner (session after Phase 0): a blank name is the trip's countries, in English, in route
  // order, each once. Stored as the name, so every screen that names a trip reads it unchanged.
  it("a blank name is its countries' names in route order, each once", () => {
    const r = built({ name: "  ", stops: [{ countryCode: "FR", city: "Paris" }, { countryCode: "IT" }, { countryCode: "FR", city: "Lyon" }, { countryCode: "MT" }] });
    expect(r.ok && r.trip.name).toBe("France, Italy, Malta");
    expect(defaultTripName([{ countryCode: "XK" }, { countryCode: "LB" }])).toBe("Kosovo, Lebanon");
  });

  it("a blank name with no countries is still refused", () => {
    expect(built({ name: "" })).toEqual({ ok: false, reason: "name" });
  });

  it("a bad stop is refused before the name is filled from it", () => {
    expect(built({ name: "", stops: [{ countryCode: "ZZ" }] })).toEqual({ ok: false, reason: "stops" });
  });
});

describe("editing a trip's countries, cities and notes", () => {
  const p = { name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200 };
  const withStops = { ...LISBON, stops: [{ id: "s1", countryCode: "PT", city: "Lisbon", lat: 38.72, lon: -9.14 }], notes: "Fado" } as StoredTrip;

  it("an edit that doesn't send stops or notes keeps them (today's form sends neither)", () => {
    const r = editTrip(data([], [withStops]), "trip-lis", { ...p, budgetUSD: 900 });
    if (!r.ok) throw new Error("refused");
    expect(r.data.trips![0]).toMatchObject({ budgetUSD: 900, stops: withStops.stops, notes: "Fado" });
  });

  it("an edit that sends them replaces them; an empty list and empty notes clear them", () => {
    const r = editTrip(data([], [withStops]), "trip-lis", { ...p, stops: [{ id: "s1", countryCode: "PT", city: "Lisbon", lat: 38.72, lon: -9.14 }, { countryCode: "PT", city: "Porto" }], notes: "Fado, then port" });
    if (!r.ok) throw new Error("refused");
    expect(r.data.trips![0].stops!.map((s) => s.city)).toEqual(["Lisbon", "Porto"]);
    expect(r.data.trips![0].stops![0].id).toBe("s1");
    expect(r.data.trips![0].notes).toBe("Fado, then port");
    const cleared = editTrip(data([], [withStops]), "trip-lis", { ...p, stops: [], notes: "" });
    if (!cleared.ok) throw new Error("refused");
    expect(cleared.data.trips![0]).not.toHaveProperty("stops");
    expect(cleared.data.trips![0]).not.toHaveProperty("notes");
  });

  // Owner: a name left blank on edit re-fills from the countries the trip has after the edit.
  it("a name left blank re-fills from the countries after the edit", () => {
    const kept = editTrip(data([], [withStops]), "trip-lis", { ...p, name: "" });
    expect(kept.ok && kept.data.trips![0].name).toBe("Portugal");
    const changed = editTrip(data([], [withStops]), "trip-lis", { ...p, name: " ", stops: [{ countryCode: "ES" }, { countryCode: "PT" }] });
    expect(changed.ok && changed.data.trips![0].name).toBe("Spain, Portugal");
  });

  it("a name left blank on a trip with no countries is refused, as before", () => {
    expect(editTrip(data([]), "trip-lis", { ...p, name: "" })).toEqual({ ok: false, reason: "name" });
  });

  it("still keeps a field neither the form nor this code sets (Phase 0)", () => {
    const newer = { ...withStops, futureField: { a: 1 } } as StoredTrip;
    const r = editTrip(data([], [newer]), "trip-lis", { ...p, notes: "x" });
    expect(r.ok && (r.data.trips![0] as StoredTrip & { futureField?: unknown }).futureField).toEqual({ a: 1 });
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
