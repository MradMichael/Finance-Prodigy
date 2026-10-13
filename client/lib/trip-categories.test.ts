// Session 22, items 1c-1e (owner; HELD): a trip's category view and its
// untagged spends. The owner's example: €400 bought for $460.04; a €40 dinner
// from that cash (Food & dining); a $300 hotel by card (Accommodation); a
// Netflix charge inside the trip's dates, untagged.
// - The trip total is exchanges + tagged USD/LBP spends − tagged refunds and
//   change-backs: $460.04 + $300 = $760.04, never $803 (the euros are
//   already counted at the exchange).
// - The category view counts dollars per category and shows euros spent from
//   cash beside them, not added. A category budget compares against counted
//   dollars plus its euros at the trip's average exchange cost, "≈ $X from
//   cash": €40 × 460.04 / 400 = ≈ $46.00.
// - Netflix stays out until tagged, and is listed as untagged during the trip.
import { it, expect } from "vitest";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";
import { buildExchange, buildChangeBack, buildForeignEntry } from "./foreignCash";
import { tripActual, tripCategoryView, untaggedDuringTrip, tagToTrip, tripExchangeCost, type StoredTrip } from "./trips";

const TRIP: StoredTrip = { id: "paris", name: "Paris", startDate: "2026-10-01", endDate: "2026-10-10", budgetUSD: 1000, categoryBudgetsUSD: { "travel-food": 100, "travel-accommodation": 400 }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const exchange = buildExchange({ date: "2026-09-28", paid: 460.04, paidCurrency: "USD", from: { paymentMethod: "card", cardId: "c1", cardLabel: "Visa" }, code: "EUR", received: 400, description: "Bought EUR", tripId: "paris" }, 89_500);
const dinner = buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-10-03", description: "Dinner", category: "travel-food", tripId: "paris" });
const hotel = { id: "t-hotel", amount: 300, currency: "USD", bucket: "WANTS", category: "travel-accommodation", description: "Hotel Lutetia", date: "2026-10-02", paymentMethod: "card", tripId: "paris" } as StoredTransaction;
const netflix = { id: "t-netflix", amount: 15.99, currency: "USD", bucket: "WANTS", category: "subscriptions", description: "Netflix", date: "2026-10-05", paymentMethod: "card" } as StoredTransaction;
const data = (extra: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, trips: [TRIP], transactions: [exchange, hotel, netflix], foreignEntries: [dinner], ...extra }) as LocalFinancials;

it("the trip total is the exchange plus the tagged card spend: $760.04, never $803", () => {
  expect(tripActual(data(), TRIP).totalUSD).toBe(760.04);
  expect(tripCategoryView(data(), TRIP).totalUSD).toBe(760.04);
});

it("the trip's average exchange cost is what was paid over what was received: $1.1501 per euro", () => {
  expect(tripExchangeCost(data(), TRIP)).toEqual({ EUR: 460.04 / 400 });
});

it("each category counts its dollars and shows its euros beside them, at ≈ the exchange cost, never adding them", () => {
  const view = tripCategoryView(data(), TRIP);
  const row = (k: string) => view.rows.find((r) => r.key === k)!;
  expect(row("travel-accommodation")).toMatchObject({ countedUSD: 300, fromCash: [], budgetUSD: 400, comparedUSD: 300 });
  expect(row("travel-food")).toMatchObject({ countedUSD: 0, budgetUSD: 100, comparedUSD: 46 });
  expect(row("travel-food").fromCash).toEqual([{ code: "EUR", amount: 40, approxUSD: 46 }]);
  expect(view.exchangesUSD).toBe(460.04); // in the total, in no category row
  expect(view.rows.some((r) => r.key === "travel")).toBe(false);
  expect(view.rows.reduce((s, r) => s + r.countedUSD, 0) + view.exchangesUSD).toBe(view.totalUSD);
});

it("travel categories come first, in the picker's order; other categories after", () => {
  const taxi = { ...hotel, id: "t-taxi", amount: 20, category: "travel-local-transport", description: "Taxi" } as StoredTransaction;
  const pharmacy = { ...hotel, id: "t-pharm", amount: 12, category: "health", description: "Pharmacy" } as StoredTransaction;
  const keys = tripCategoryView(data({ transactions: [exchange, pharmacy, hotel, taxi, netflix] }), TRIP).rows.map((r) => r.key);
  expect(keys).toEqual(["travel-accommodation", "travel-local-transport", "travel-food", "health"]);
});

it("a change-back lowers the total with the exchanges, not a category", () => {
  const back = buildChangeBack({ date: "2026-10-11", code: "EUR", given: 100, received: 105, receivedCurrency: "USD", to: { paymentMethod: "cash" }, description: "Changed back", tripId: "paris" }, 89_500);
  const view = tripCategoryView(data({ transactions: [exchange, hotel, netflix, back] }), TRIP);
  expect(view.exchangesUSD).toBe(355.04);
  expect(view.totalUSD).toBe(655.04);
  expect(view.totalUSD).toBe(tripActual(data({ transactions: [exchange, hotel, netflix, back] }), TRIP).totalUSD);
});

it("Netflix, inside the dates and untagged, is listed as untagged during the trip, and counts nowhere until tagged", () => {
  expect(untaggedDuringTrip(data(), TRIP).map((t) => t.description)).toEqual(["Netflix"]);
  const tagged = tagToTrip(data(), "t-netflix", "paris", new Date("2026-10-13T10:00:00.000Z"));
  expect(tripActual(tagged, TRIP).totalUSD).toBe(776.03);
  expect(untaggedDuringTrip(tagged, TRIP)).toEqual([]);
  expect(tagged.transactions.find((t) => t.id === "t-netflix")).toMatchObject({ tripId: "paris", updatedAt: "2026-10-13T10:00:00.000Z" });
});

it("untagged during the trip leaves out income, transfers, exchanges, deleted rows and anything outside the dates", () => {
  const extra = [
    { ...netflix, id: "u-income", bucket: "INCOME", description: "Salary" },
    { ...netflix, id: "u-transfer", bucket: "TRANSFER", description: "To savings" },
    { ...buildExchange({ date: "2026-10-04", paid: 100, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 90, description: "More EUR" }, 89_500), id: "u-exchange" },
    { ...netflix, id: "u-deleted", description: "Deleted", deletedAt: "2026-10-06T00:00:00.000Z" },
    { ...netflix, id: "u-before", date: "2026-09-30", description: "Before" },
    { ...netflix, id: "u-after", date: "2026-10-11", description: "After" },
    { ...netflix, id: "u-first", date: "2026-10-01", description: "First day" },
    { ...netflix, id: "u-last", date: "2026-10-10", description: "Last day" },
  ] as StoredTransaction[];
  const list = untaggedDuringTrip(data({ transactions: [exchange, hotel, netflix, ...extra] }), TRIP).map((t) => t.description);
  expect(list).toEqual(["First day", "Netflix", "Last day"]);
});
