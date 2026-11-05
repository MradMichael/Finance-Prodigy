// Travel map plan, Phase 1b (owner's decision D9): a trip with a $0 budget (a
// past trip added for the map, say) doesn't read "Budget $0.00 · ... over" in
// coral. With spending it shows "Spent $X" in plain text; with none, no line.
// A budget above 0 keeps its line. USD figures, so tested first (brief rule 4).
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import TripsScreen from "./TripsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { THEMES } from "../../lib/theme";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../../lib/localData";
import type { StoredTrip } from "../../lib/trips";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const trip = (budgetUSD: number): StoredTrip =>
  ({ id: "trip-par", name: "Paris 2019", startDate: "2019-04-10", endDate: "2019-04-15", budgetUSD, createdAt: "2026-11-05T09:00:00.000Z", updatedAt: "2026-11-05T09:00:00.000Z" });
const row = (id: string, amount: number, extra: Partial<StoredTransaction> = {}) =>
  ({ id, amount, currency: "USD", bucket: "WANTS", description: id, date: "2019-04-11", tripId: "trip-par", ...extra }) as StoredTransaction;
const show = (t: StoredTrip, rows: StoredTransaction[] = []) =>
  render(<ThemeProvider><TripsScreen financials={{ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions: rows, trips: [t] } as LocalFinancials} onChange={vi.fn()} /></ThemeProvider>);
const card = () => within(screen.getByRole("region", { name: "Paris 2019" }));
// jsdom reports a style colour as rgb(); the default theme in tests is Ivory.
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

it("budget 0 with spending: \"Spent $X\" in plain text, no \"over\", no coral", () => {
  show(trip(0), [row("dinner", 85.5), row("museum", 30)]);
  const line = card().getByText("Spent $115.50");
  expect((line as HTMLElement).style.color).toBe(rgb(THEMES.ivory.text));
  expect((line as HTMLElement).style.color).not.toBe(rgb(THEMES.ivory.coral));
  expect(card().queryByText(/over/)).toBeNull();
  expect(card().queryByText(/Budget \$0\.00/)).toBeNull();
});

it("budget 0 with a lira spend: converted as every trip figure is", () => {
  show(trip(0), [row("taxi", 895_000, { currency: "LBP" })]);
  expect(card().getByText("Spent $10.00")).toBeTruthy();
});

it("budget 0 and nothing spent: no budget line at all", () => {
  show(trip(0));
  expect(card().queryByText(/^Spent /)).toBeNull();
  expect(card().queryByText(/^Budget /)).toBeNull();
});

it("budget 0 where refunds cancel the spending to the cent: nothing spent, so no line", () => {
  show(trip(0), [row("hotel", 120.1), row("refund", 120.1, { bucket: "INCOME" })]);
  expect(card().queryByText(/^Spent /)).toBeNull();
  expect(card().queryByText(/^Budget /)).toBeNull();
});

it("a budget above 0 keeps today's line, \"over\" and coral included", () => {
  show(trip(100), [row("dinner", 115.5)]);
  const line = card().getByText("Budget $100.00 · spent $115.50 · $15.50 over");
  expect((line as HTMLElement).style.color).toBe(rgb(THEMES.ivory.coral));
});
