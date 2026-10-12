// Travel slice 2 (HELD; new wording DRAFT): the Trips screen.
//   - New trip: a name, start and end dates, a budget in USD, and optional
//     budgets by category. Refused with a reason when it doesn't make sense.
//   - Each trip: planned against actual in USD at cost (lib/trips.ts), by
//     category where it has category budgets, its foreign cash bought, and
//     the rows tagged to it.
//   - Delete trip: gone, with the deletion recorded; its rows keep their tags.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import TripsScreen from "./TripsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../../lib/localData";
import { buildExchange, buildPocketSpend } from "../../lib/foreignCash";
import type { StoredTrip } from "../../lib/trips";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const LISBON: StoredTrip = { id: "trip-lis", name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200, categoryBudgetsUSD: { dining: 400 }, createdAt: "2026-10-12T09:00:00.000Z", updatedAt: "2026-10-12T09:00:00.000Z" };
const fin = (transactions: StoredTransaction[] = [], trips: StoredTrip[] = []) =>
  ({ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions, trips }) as LocalFinancials;
function show(d: LocalFinancials) {
  const onChange = vi.fn();
  render(<ThemeProvider><TripsScreen financials={d} onChange={onChange} /></ThemeProvider>);
  return { onChange, written: () => onChange.mock.calls.at(-1)![0] as LocalFinancials };
}
const setDate = (el: HTMLElement, iso: string) => fireEvent.change(el.querySelector('input[type="date"]')!, { target: { value: iso } });

it("creates a trip with a name, dates, a budget and a category budget", () => {
  const { written } = show(fin());
  const form = screen.getByRole("form", { name: "New trip" });
  fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Lisbon" } });
  setDate(within(form).getByTestId("trip-start"), "2026-11-02");
  setDate(within(form).getByTestId("trip-end"), "2026-11-09");
  fireEvent.change(within(form).getByLabelText("Budget ($)"), { target: { value: "1200" } });
  fireEvent.click(within(form).getByRole("button", { name: "Add a category budget" }));
  fireEvent.change(within(form).getByLabelText("Category"), { target: { value: "dining" } });
  fireEvent.change(within(form).getByLabelText("Category budget ($)"), { target: { value: "400" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save trip" }));
  expect(written().trips).toEqual([expect.objectContaining({ name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200, categoryBudgetsUSD: { dining: 400 } })]);
});

it("refuses a trip that doesn't make sense, and says why", () => {
  const { onChange } = show(fin());
  const form = screen.getByRole("form", { name: "New trip" });
  fireEvent.click(within(form).getByRole("button", { name: "Save trip" }));
  expect(within(form).getByText("Name the trip.")).toBeTruthy();
  fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Lisbon" } });
  setDate(within(form).getByTestId("trip-start"), "2026-11-09");
  setDate(within(form).getByTestId("trip-end"), "2026-11-02");
  fireEvent.click(within(form).getByRole("button", { name: "Save trip" }));
  expect(within(form).getByText("The end date can't be before the start date.")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});

it("shows planned against actual in USD at cost, by category, its foreign cash bought, and its rows", () => {
  const exch = buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500);
  const spend = { ...buildPocketSpend({ date: "2026-11-03", code: "EUR", amount: 40, bucket: "WANTS", category: "dining", description: "Dinner in Lisbon", costPerUnitUSD: 500 / 460 }), tripId: "trip-lis" };
  const taxi = { id: "taxi", amount: 30, currency: "USD", bucket: "NEEDS", description: "Airport taxi", date: "2026-11-02", tripId: "trip-lis" } as StoredTransaction;
  show(fin([...exch.map((t) => ({ ...t, tripId: "trip-lis" })), spend, taxi], [LISBON]));
  const card = screen.getByRole("region", { name: "Lisbon" });
  expect(within(card).getByText("Budget $1,200.00 · spent $73.48 · $1,126.52 left")).toBeTruthy();
  expect(within(card).getByText("Dining out: $43.48 of $400.00")).toBeTruthy();
  expect(within(card).getByText("Uncategorized: $30.00")).toBeTruthy();
  expect(within(card).getByText("Foreign cash bought for this trip: €460.00 for $500.00")).toBeTruthy();
  expect(within(card).getByText(/Dinner in Lisbon/)).toBeTruthy();
  expect(within(card).getByText(/Airport taxi/)).toBeTruthy();
});

it("over budget says by how much", () => {
  const big = { id: "hotel", amount: 1300, currency: "USD", bucket: "NEEDS", description: "Hotel", date: "2026-11-02", tripId: "trip-lis" } as StoredTransaction;
  show(fin([big], [LISBON]));
  expect(within(screen.getByRole("region", { name: "Lisbon" })).getByText("Budget $1,200.00 · spent $1,300.00 · $100.00 over")).toBeTruthy();
});

it("deleting a trip records it and keeps its rows' tags", () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const taxi = { id: "taxi", amount: 30, currency: "USD", bucket: "NEEDS", description: "Airport taxi", date: "2026-11-02", tripId: "trip-lis" } as StoredTransaction;
  const { written } = show(fin([taxi], [LISBON]));
  fireEvent.click(within(screen.getByRole("region", { name: "Lisbon" })).getByRole("button", { name: "Delete trip" }));
  expect(window.confirm).toHaveBeenCalledWith("Delete this trip? Its entries keep their tag, and count toward no trip.");
  expect(written().trips).toEqual([]);
  expect(written().deletedKeys?.trips?.map((t) => t.key)).toEqual(["trip-lis"]);
  expect(written().transactions[0].tripId).toBe("trip-lis");
});

it("with no trips, says so", () => {
  show(fin());
  expect(screen.getByText("No trips yet.")).toBeTruthy();
});
