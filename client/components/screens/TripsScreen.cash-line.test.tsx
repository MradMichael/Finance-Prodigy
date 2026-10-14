// Session 23, item 2 (owner-approved wording): a category line with cash spends.
//   cash only:     "Food & dining: €40.00 from cash (≈ $46.00) · ≈ $46.00 of $100.00"
//   card and cash: "Food & dining: $15.00 + €40.00 from cash (≈ $46.00) · ≈ $61.00 of $100.00"
// " of $X" only with a category budget. It read "Food & dining: $0.00 counted ·
// €40.00 spent from cash (≈ $46.00 from cash) · ≈ $46.00 of $100.00".
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import TripsScreen from "./TripsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../../lib/localData";
import { buildExchange, buildForeignEntry } from "../../lib/foreignCash";
import type { StoredTrip } from "../../lib/trips";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const trip = (budgets?: Record<string, number>): StoredTrip => ({ id: "paris", name: "Paris", startDate: "2026-10-01", endDate: "2026-10-10", budgetUSD: 1000, ...(budgets ? { categoryBudgetsUSD: budgets } : {}), createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" });
const exchange = buildExchange({ date: "2026-09-28", paid: 460.04, paidCurrency: "USD", from: { paymentMethod: "card", cardId: "c1", cardLabel: "Visa" }, code: "EUR", received: 400, description: "Bought EUR", tripId: "paris" }, 89_500);
const dinner = buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-10-03", description: "Dinner", category: "travel-food", tripId: "paris" });
const cafe = { id: "t-cafe", amount: 15, currency: "USD", bucket: "WANTS", category: "travel-food", description: "Café", date: "2026-10-04", paymentMethod: "card", tripId: "paris" } as StoredTransaction;
function lineFor(t: StoredTrip, transactions: StoredTransaction[]) {
  const data = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, trips: [t], transactions, foreignEntries: [dinner] } as LocalFinancials;
  render(<ThemeProvider><TripsScreen financials={data} onChange={vi.fn()} /></ThemeProvider>);
  const card = screen.getByRole("region", { name: "Paris" });
  return within(card).getAllByRole("listitem").map((li) => li.textContent).find((t) => t?.startsWith("Food & dining"));
}

it("cash only, with a budget", () => {
  expect(lineFor(trip({ "travel-food": 100 }), [exchange])).toBe("Food & dining: €40.00 from cash (≈ $46.00) · ≈ $46.00 of $100.00");
});

it("card and cash, with a budget", () => {
  expect(lineFor(trip({ "travel-food": 100 }), [exchange, cafe])).toBe("Food & dining: $15.00 + €40.00 from cash (≈ $46.00) · ≈ $61.00 of $100.00");
});

it("without a category budget, the line stops after the cash", () => {
  expect(lineFor(trip(), [exchange])).toBe("Food & dining: €40.00 from cash (≈ $46.00)");
  cleanup();
  expect(lineFor(trip(), [exchange, cafe])).toBe("Food & dining: $15.00 + €40.00 from cash (≈ $46.00)");
});

it("with no exchange of that currency on the trip, there's no ≈ figure, and the budget compares the dollars only", () => {
  expect(lineFor(trip({ "travel-food": 100 }), [cafe])).toBe("Food & dining: $15.00 + €40.00 from cash · $15.00 of $100.00");
});
