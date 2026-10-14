// Session 22, items 1c-1e on the card (owner; HELD, wording drafted). The
// owner's example: €400 for $460.04; a €40 dinner from cash (Food & dining);
// a $300 hotel by card (Accommodation); Netflix inside the dates, untagged.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import TripsScreen from "./TripsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../../lib/localData";
import { buildExchange, buildForeignEntry } from "../../lib/foreignCash";
import type { StoredTrip } from "../../lib/trips";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const PARIS: StoredTrip = { id: "paris", name: "Paris", startDate: "2026-10-01", endDate: "2026-10-10", budgetUSD: 1000, categoryBudgetsUSD: { "travel-food": 100, "travel-accommodation": 400 }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const exchange = buildExchange({ date: "2026-09-28", paid: 460.04, paidCurrency: "USD", from: { paymentMethod: "card", cardId: "c1", cardLabel: "Visa" }, code: "EUR", received: 400, description: "Bought EUR", tripId: "paris" }, 89_500);
const dinner = buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-10-03", description: "Dinner", category: "travel-food", tripId: "paris" });
const hotel = { id: "t-hotel", amount: 300, currency: "USD", bucket: "WANTS", category: "travel-accommodation", description: "Hotel Lutetia", date: "2026-10-02", paymentMethod: "card", tripId: "paris" } as StoredTransaction;
const netflix = { id: "t-netflix", amount: 15.99, currency: "USD", bucket: "WANTS", category: "subscriptions", description: "Netflix", date: "2026-10-05", paymentMethod: "card" } as StoredTransaction;
function show(transactions: StoredTransaction[] = [exchange, hotel, netflix]) {
  const onChange = vi.fn();
  const data = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, trips: [PARIS], transactions, foreignEntries: [dinner] } as LocalFinancials;
  render(<ThemeProvider><TripsScreen financials={data} onChange={onChange} /></ThemeProvider>);
  return { card: screen.getByRole("region", { name: "Paris" }), onChange, written: () => onChange.mock.calls.at(-1)![0] as LocalFinancials };
}

it("the total is the exchange plus the tagged card spend, $760.04; the euros are never added", () => {
  const { card } = show();
  expect(within(card).getByText("Budget $1,000.00 · spent $760.04 · $239.96 left")).toBeTruthy();
  expect(within(card).queryByText(/803/)).toBeNull();
});

it("by category: dollars counted, the euros beside them, and each budget against both, the euros at ≈ the exchange cost", () => {
  const { card } = show();
  expect(within(card).getByText("By category")).toBeTruthy();
  expect(within(card).getByText("Accommodation: $300.00 of $400.00")).toBeTruthy();
  expect(within(card).getByText("Food & dining: €40.00 from cash (≈ $46.00) · ≈ $46.00 of $100.00")).toBeTruthy(); // owner-approved form (session 23)
  expect(within(card).getByText("Exchanges: $460.04, counted in the total, not by category")).toBeTruthy();
});

it("Netflix, inside the dates and untagged, is listed under Untagged during this trip; one tap tags it", () => {
  const { card, written } = show();
  const list = within(card).getByRole("list", { name: "Untagged during this trip" });
  expect(within(list).getByText("05/10/2026 · Netflix · $15.99")).toBeTruthy();
  fireEvent.click(within(list).getByRole("button", { name: "Add Netflix to this trip" }));
  expect(written().transactions.find((t) => t.id === "t-netflix")).toMatchObject({ tripId: "paris" });
});

it("with nothing untagged during the trip, the list isn't shown", () => {
  const { card } = show([exchange, hotel]);
  expect(within(card).queryByText("Untagged during this trip")).toBeNull();
});
