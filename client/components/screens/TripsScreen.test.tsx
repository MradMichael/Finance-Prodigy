// Travel slice 2 (HELD; wording approved in session 17): the Trips screen.
//   - New trip: a name, start and end dates, a budget in USD, and optional
//     budgets by category. Refused with a reason when it doesn't make sense.
//   - Each trip: planned against actual in USD (lib/trips.ts; model 2: an
//     exchange counts, a change-back or refund lowers it), by category, the
//     trip's euro spends in euros by category (approved, session 19), and the rows
//     counted.
//   - Delete trip: gone, with the deletion recorded; its rows keep their tags.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import TripsScreen from "./TripsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../../lib/localData";
import { buildExchange, buildChangeBack, buildForeignEntry } from "../../lib/foreignCash";
import type { StoredTrip } from "../../lib/trips";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const LISBON: StoredTrip = { id: "trip-lis", name: "Lisbon", startDate: "2026-11-02", endDate: "2026-11-09", budgetUSD: 1200, categoryBudgetsUSD: { dining: 400 }, createdAt: "2026-10-12T09:00:00.000Z", updatedAt: "2026-10-12T09:00:00.000Z" };
const fin = (transactions: StoredTransaction[] = [], trips: StoredTrip[] = [], extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions, trips, ...extra }) as LocalFinancials;
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

it("shows planned against actual in USD by category, the euro spends in euros by category, and the rows counted", () => {
  const exch = { ...buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500), tripId: "trip-lis" };
  const back = { ...buildChangeBack({ date: "2026-11-10", code: "EUR", given: 100, received: 105, receivedCurrency: "USD", to: { paymentMethod: "cash" }, description: "Changed back from EUR" }, 89_500), tripId: "trip-lis" };
  const taxi = { id: "taxi", amount: 30, currency: "USD", bucket: "NEEDS", description: "Airport taxi", date: "2026-11-02", tripId: "trip-lis" } as StoredTransaction;
  const dinner = buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-11-03", description: "Dinner in Lisbon", category: "dining", tripId: "trip-lis" });
  show(fin([exch, back, taxi], [LISBON], { foreignEntries: [dinner] }));
  const card = screen.getByRole("region", { name: "Lisbon" });
  expect(within(card).getByText("Budget $1,200.00 · spent $425.00 · $775.00 left")).toBeTruthy(); // 500 + 30 - 105
  // Session 22, item 1d (HELD, wording drafted): the category view. Euros beside the dollars, never added; the
  // budget compares against both, the euros at the trip's exchange cost ($500 for €460: €40 ≈ $43.48).
  expect(within(card).getByText("Dining out: $0.00 counted · €40.00 spent from cash (≈ $43.48 from cash) · ≈ $43.48 of $400.00")).toBeTruthy();
  expect(within(card).getByText("Exchanges: $395.00, counted in the total, not by category")).toBeTruthy();
  expect(within(card).getByText("Uncategorized: $30.00")).toBeTruthy();
  expect(within(card).getByText("Spent from EUR cash: €40.00")).toBeTruthy();
  expect(within(card).queryByText(/Foreign cash bought/)).toBeNull();
  const rows = within(card).getAllByRole("listitem").map((li) => li.textContent ?? "");
  expect(rows.find((r) => r.includes("Exchange to EUR"))).toContain("$500.00 (€460.00)");
  expect(rows.find((r) => r.includes("Changed back from EUR"))).toContain("−$105.00 (€100.00)");
  expect(rows.some((r) => r.includes("Airport taxi"))).toBe(true);
  expect(rows.some((r) => r.includes("Dinner in Lisbon"))).toBe(false); // a euro spend is no ledger row
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
  expect(window.confirm).toHaveBeenCalledWith("Delete this trip? Its entries stay as they are, but won't count toward any trip."); // owner, session 17, item 4
  expect(written().trips).toEqual([]);
  expect(written().deletedKeys?.trips?.map((t) => t.key)).toEqual(["trip-lis"]);
  expect(written().transactions[0].tripId).toBe("trip-lis");
});

// Session 17, item 2: "Edit trip" opens the trip's own form, filled in;
// "Save changes" saves it (approved labels; the fields and errors are slice 2's
// approved ones). Every tag stays. Pressing "Edit trip" again closes it unsaved.
describe("editing a trip", () => {
  const taxi = { id: "taxi", amount: 30, currency: "USD", bucket: "NEEDS", description: "Airport taxi", date: "2026-11-02", tripId: "trip-lis" } as StoredTransaction;
  const open = () => {
    const r = show(fin([taxi], [LISBON]));
    fireEvent.click(within(screen.getByRole("region", { name: "Lisbon" })).getByRole("button", { name: "Edit trip" }));
    return { ...r, form: screen.getByRole("form", { name: "Edit trip" }) };
  };

  it("opens filled in with the trip as it is", () => {
    const { form } = open();
    expect((within(form).getByLabelText("Name") as HTMLInputElement).value).toBe("Lisbon");
    expect((within(form).getByTestId("trip-edit-start").querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-11-02");
    expect((within(form).getByTestId("trip-edit-end").querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-11-09");
    expect((within(form).getByLabelText("Budget ($)") as HTMLInputElement).value.replace(/,/g, "")).toBe("1200");
    expect((within(form).getByLabelText("Category") as HTMLSelectElement).value).toBe("dining");
    expect((within(form).getByLabelText("Category budget ($)") as HTMLInputElement).value).toBe("400");
  });

  it("saves its name, dates, budget and category budgets; same trip, every tag kept", () => {
    const { form, written } = open();
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Lisbon and Porto" } });
    setDate(within(form).getByTestId("trip-edit-start"), "2026-11-01");
    setDate(within(form).getByTestId("trip-edit-end"), "2026-11-12");
    fireEvent.change(within(form).getByLabelText("Budget ($)"), { target: { value: "1500" } });
    fireEvent.change(within(form).getByLabelText("Category budget ($)"), { target: { value: "500" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add a category budget" }));
    fireEvent.change(within(form).getAllByLabelText("Category")[1], { target: { value: "transport" } });
    fireEvent.change(within(form).getAllByLabelText("Category budget ($)")[1], { target: { value: "150" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(written().trips).toEqual([expect.objectContaining({ id: "trip-lis", name: "Lisbon and Porto", startDate: "2026-11-01", endDate: "2026-11-12", budgetUSD: 1500, categoryBudgetsUSD: { dining: 500, transport: 150 }, createdAt: LISBON.createdAt })]);
    expect(written().trips![0].updatedAt).not.toBe(LISBON.updatedAt);
    expect(written().transactions).toEqual([taxi]);
    expect(screen.queryByRole("form", { name: "Edit trip" })).toBeNull();
  });

  it("clearing a category budget's amount removes it", () => {
    const { form, written } = open();
    fireEvent.change(within(form).getByLabelText("Category budget ($)"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(written().trips![0]).not.toHaveProperty("categoryBudgetsUSD");
  });

  it("refuses an edit that doesn't make sense, with the approved reasons, and saves nothing", () => {
    const { form, onChange } = open();
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: " " } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(within(form).getByText("Name the trip.")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Lisbon" } });
    setDate(within(form).getByTestId("trip-edit-end"), "2026-11-01");
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(within(form).getByText("The end date can't be before the start date.")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pressing Edit trip again closes the form without saving", () => {
    const { onChange } = open();
    fireEvent.change(within(screen.getByRole("form", { name: "Edit trip" })).getByLabelText("Name"), { target: { value: "Changed" } });
    fireEvent.click(within(screen.getByRole("region", { name: "Lisbon" })).getByRole("button", { name: "Edit trip" }));
    expect(screen.queryByRole("form", { name: "Edit trip" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the new-trip form is untouched by an open edit", () => {
    const { form } = open();
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Changed" } });
    expect((within(screen.getByRole("form", { name: "New trip" })).getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });
});

it("with no trips, says so", () => {
  show(fin());
  expect(screen.getByText("No trips yet.")).toBeTruthy();
});
