// Session 23, item 2 (owner): with plan J merged, every trip figure is at each
// row's own day's rate. The trip total already was (plan J's tripActual); the
// exchange cost and the category view used the cycle's rate, so an exchange
// paid in lira moved with a later rate edit. The rate here was L£89,500 until
// an edit to 179,000 on 5 Oct, which the load-time snapshot has written into
// October's history.
import { it, expect } from "vitest";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";
import { buildExchange, buildForeignEntry } from "./foreignCash";
import { tripActual, tripCategoryView, tripExchangeCost, type StoredTrip } from "./trips";
import { asCycleKey } from "./period";

const TRIP: StoredTrip = { id: "jbeil", name: "Jbeil", startDate: "2026-10-01", endDate: "2026-10-12", budgetUSD: 500, categoryBudgetsUSD: { "travel-food": 100 }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const exchange = buildExchange({ date: "2026-10-03", paid: 8_950_000, paidCurrency: "LBP", from: { paymentMethod: "cash" }, code: "EUR", received: 80, description: "Bought EUR", tripId: "jbeil" }, 89_500);
const dinner = buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-10-06", description: "Dinner", category: "travel-food", tripId: "jbeil" });
const taxi = { id: "t-taxi", amount: 895_000, currency: "LBP", bucket: "WANTS", category: "travel-local-transport", description: "Taxi", date: "2026-10-02", paymentMethod: "cash", tripId: "jbeil" } as StoredTransaction;
const data = (transactions: StoredTransaction[] = [exchange]) => ({
  ...DEFAULT_DATA, cycleStartDay: 1, income: 3000, lbpRate: 179_000,
  lbpRateHistory: [{ ym: asCycleKey("2026-10"), value: 179_000 }],
  lbpRateLog: [{ from: "2026-10-01", value: 89_500 }, { from: "2026-10-05", value: 179_000 }],
  trips: [TRIP], transactions, foreignEntries: [dinner],
}) as LocalFinancials;

it("an exchange paid in lira costs what it did on its own day: $100 for €80, $1.25 a euro (the cycle's rate made it $0.625)", () => {
  expect(tripExchangeCost(data(), TRIP)).toEqual({ EUR: 1.25 });
  const view = tripCategoryView(data(), TRIP);
  expect(view.exchangesUSD).toBe(100);
  expect(view.totalUSD).toBe(tripActual(data(), TRIP).totalUSD);
  expect(view.totalUSD).toBe(100);
  expect(view.rows.find((r) => r.key === "travel-food")!.fromCash).toEqual([{ code: "EUR", amount: 40, approxUSD: 50 }]);
});

it("a lira spend in the category view counts at its own day's rate too, and the view still adds up to the trip total", () => {
  const view = tripCategoryView(data([exchange, taxi]), TRIP);
  expect(view.rows.find((r) => r.key === "travel-local-transport")!.countedUSD).toBe(10);
  expect(view.totalUSD).toBe(tripActual(data([exchange, taxi]), TRIP).totalUSD);
  expect(view.totalUSD).toBe(110);
});
