// Foreign cash, model 2 (session 18, held; new wording DRAFT): the currency
// screen's foreign cash, as a sheet per currency.
//   - Record an exchange: the pool it came from, what was paid (USD or LBP),
//     the currency and amount received, the date (past allowed), the trip
//     (defaulting to the one holding the date, else the next one). The rate
//     and what it counts as are shown first. ONE Wants/Travel row is added.
//   - Each sheet: its balance, and its lines with a running balance.
//   - Spend from it: a sheet entry (amount, description, category, date,
//     trip); no budget bucket, no cost. Not counted in the budget.
//   - Change back: ONE reimbursement-shaped row (a TRANSFER that gained) on
//     the pool the money went to; it nets against Wants (session 19).
//   - Cash received (decision 4): a sheet entry in, no USD effect.
//   - A sheet entry can be deleted (decision 7: re-entered to undo).
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import ForeignCashPanel from "./ForeignCashPanel";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredForeignEntry, type StoredTransaction } from "../lib/localData";
import { buildExchange, buildForeignEntry } from "../lib/foreignCash";
import type { StoredTrip } from "../lib/trips";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const base = (transactions: StoredTransaction[] = [], extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions, ...extra }) as LocalFinancials;
const EXCH = { ...buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500), createdAt: "2026-10-03T09:00:00.000Z" };
const DINNER: StoredForeignEntry = buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-10-05", description: "Dinner", category: "dining" }, new Date("2026-10-05T20:00:00.000Z"));
const LISBON: StoredTrip = { id: "trip-lis", name: "Lisbon", startDate: "2026-10-10", endDate: "2026-10-20", budgetUSD: 1200, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" };
function show(d: LocalFinancials) {
  const onChange = vi.fn();
  render(<ThemeProvider><ForeignCashPanel financials={d} onChange={onChange} /></ThemeProvider>);
  return { onChange, written: () => onChange.mock.calls.at(-1)![0] as LocalFinancials };
}
const setDate = (form: HTMLElement, iso: string) => fireEvent.change(form.querySelector('input[type="date"]')!, { target: { value: iso } });

it("records an exchange on a past date: the rate and what it counts as first, then one Wants/Travel row, tagged to the coming trip", () => {
  const { written } = show(base([], { trips: [LISBON] }));
  fireEvent.click(screen.getByRole("button", { name: "Record an exchange" }));
  const form = screen.getByRole("form", { name: "Record an exchange" });
  setDate(form, "2026-10-03");
  fireEvent.click(within(form).getByRole("button", { name: /Cash/ }));
  fireEvent.change(within(form).getByLabelText("Amount paid"), { target: { value: "500" } });
  fireEvent.change(within(form).getByLabelText("Amount received"), { target: { value: "460" } });
  expect(within(form).getByText("You got €0.92 per $1 ($1.0870 per €1).")).toBeTruthy();
  expect(within(form).getByText("Counts as Travel spending of $500.00.")).toBeTruthy();
  expect((within(form).getByLabelText("Trip") as HTMLSelectElement).value).toBe("trip-lis"); // before the trip: the next one (decision 10)
  fireEvent.click(within(form).getByRole("button", { name: "Save exchange" }));
  const rows = written().transactions;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ amount: 500, currency: "USD", bucket: "WANTS", category: "travel", paymentMethod: "cash", date: "2026-10-03", description: "Exchange to EUR", fx: { code: "EUR", amount: 460, kind: "exchange" }, tripId: "trip-lis" });
});

it("refuses a code that isn't three letters, or USD or LBP, and amounts that aren't positive", () => {
  const { onChange } = show(base());
  fireEvent.click(screen.getByRole("button", { name: "Record an exchange" }));
  const form = screen.getByRole("form", { name: "Record an exchange" });
  fireEvent.change(within(form).getByLabelText("Currency received"), { target: { value: "usd" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save exchange" }));
  expect(within(form).getByText("Use a three-letter currency code other than USD or LBP, like EUR.")).toBeTruthy();
  fireEvent.change(within(form).getByLabelText("Currency received"), { target: { value: "EUR" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save exchange" }));
  expect(within(form).getByText("Enter both amounts.")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});

it("shows each sheet: its balance, and its lines with a running balance", () => {
  show(base([EXCH], { foreignEntries: [DINNER] }));
  const s = screen.getByRole("region", { name: "EUR cash" });
  expect(within(s).getByText("EUR cash · balance €420.00")).toBeTruthy();
  const lines = within(s).getAllByRole("listitem").map((li) => li.textContent);
  expect(lines[0]).toContain("Exchange to EUR"); expect(lines[0]).toContain("+€460.00"); expect(lines[0]).toContain("€460.00");
  expect(lines[1]).toContain("Dinner"); expect(lines[1]).toContain("−€40.00"); expect(lines[1]).toContain("€420.00");
});

it("a spend: no bucket and no cost; one sheet entry, and nothing in the ledger", () => {
  const { written } = show(base([EXCH], { trips: [{ ...LISBON, startDate: "2026-10-01" }] }));
  fireEvent.click(screen.getByRole("button", { name: "Spend from foreign cash" }));
  const form = screen.getByRole("form", { name: "Spend from foreign cash" });
  expect(within(form).queryByRole("button", { name: /Needs|Wants|Savings/ })).toBeNull();
  expect(within(form).getByText("Not counted in your budget: the exchange already was.")).toBeTruthy();
  setDate(form, "2026-10-05");
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "40" } });
  fireEvent.change(within(form).getByLabelText("Description"), { target: { value: "Dinner" } });
  fireEvent.change(within(form).getByLabelText("Category"), { target: { value: "dining" } });
  expect((within(form).getByLabelText("Trip") as HTMLSelectElement).value).toBe("trip-lis");
  fireEvent.click(within(form).getByRole("button", { name: "Save spend" }));
  expect(written().transactions).toEqual([EXCH]);
  expect(written().foreignEntries).toEqual([expect.objectContaining({ kind: "spend", code: "EUR", amount: 40, date: "2026-10-05", description: "Dinner", category: "dining", tripId: "trip-lis" })]);
});

it("a spend beyond what the sheet held on that date is allowed, with the warning", () => {
  show(base([EXCH]));
  fireEvent.click(screen.getByRole("button", { name: "Spend from foreign cash" }));
  const form = screen.getByRole("form", { name: "Spend from foreign cash" });
  setDate(form, "2026-10-05");
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "500" } });
  expect(within(form).getByText("That's €40.00 more than this cash held on that date.")).toBeTruthy();
});

it("changing back: one reimbursement-shaped row (a TRANSFER that gained) on the pool it went to; the sheet drops", () => {
  const { written } = show(base([EXCH]));
  fireEvent.click(screen.getByRole("button", { name: "Change back" }));
  const form = screen.getByRole("form", { name: "Change back" });
  setDate(form, "2026-10-21");
  fireEvent.change(within(form).getByLabelText("Amount changed back"), { target: { value: "100" } });
  fireEvent.change(within(form).getByLabelText("Amount received"), { target: { value: "105" } });
  fireEvent.click(within(form).getByRole("button", { name: /Cash/ }));
  fireEvent.click(within(form).getByRole("button", { name: "Save change-back" }));
  const back = written().transactions.find((t) => t.fx?.kind === "back")!;
  expect(back).toMatchObject({ amount: 105, currency: "USD", bucket: "TRANSFER", category: "travel", paymentMethod: "cash", date: "2026-10-21", description: "Changed back from EUR", fx: { code: "EUR", amount: 100, kind: "back" } });
});

it("changing back refuses amounts that aren't positive", () => {
  const { onChange } = show(base([EXCH]));
  fireEvent.click(screen.getByRole("button", { name: "Change back" }));
  const form = screen.getByRole("form", { name: "Change back" });
  fireEvent.click(within(form).getByRole("button", { name: "Save change-back" }));
  expect(within(form).getByText("Enter both amounts.")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});

it("cash received (decision 4): a sheet entry in, with no ledger row", () => {
  const { written } = show(base([EXCH]));
  fireEvent.click(screen.getByRole("button", { name: "Cash received" }));
  const form = screen.getByRole("form", { name: "Cash received" });
  setDate(form, "2026-10-06");
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "20" } });
  fireEvent.change(within(form).getByLabelText("Description"), { target: { value: "Ana paid me back" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save cash received" }));
  expect(written().transactions).toEqual([EXCH]);
  expect(written().foreignEntries).toEqual([expect.objectContaining({ kind: "in", code: "EUR", amount: 20, date: "2026-10-06", description: "Ana paid me back" })]);
});

it("deleting a sheet entry asks, then removes it and records the deletion; an exchange line has no delete here", () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { written } = show(base([EXCH], { foreignEntries: [DINNER] }));
  const s = screen.getByRole("region", { name: "EUR cash" });
  const [exLine, dinnerLine] = within(s).getAllByRole("listitem");
  expect(within(exLine).queryByRole("button", { name: "Delete" })).toBeNull();
  fireEvent.click(within(dinnerLine).getByRole("button", { name: "Delete" }));
  expect(window.confirm).toHaveBeenCalledWith("Delete this entry? To undo, enter it again.");
  expect(written().foreignEntries).toEqual([]);
  expect(written().deletedKeys?.foreignEntries?.map((t) => t.key)).toEqual([DINNER.id]);
});

// Session 19, item 3: a sheet entry is edited like any row. Its ✎ ("Edit
// entry") opens its form, filled in; "Save changes" saves; the balance
// recalculates. Fields, errors and buttons reuse approved labels. Exchange
// and change-back lines are ledger rows, edited in the transaction list.
it("editing an entry: ✎ opens it filled in; its trip and amount change; the balance recalculates", () => {
  const { written } = show(base([EXCH], { foreignEntries: [DINNER], trips: [LISBON] }));
  const s = screen.getByRole("region", { name: "EUR cash" });
  const [exLine, dinnerLine] = within(s).getAllByRole("listitem");
  expect(within(exLine).queryByRole("button", { name: "Edit entry" })).toBeNull();
  fireEvent.click(within(dinnerLine).getByRole("button", { name: "Edit entry" }));
  const form = screen.getByRole("form", { name: "Edit entry" });
  expect((within(form).getByLabelText("Amount") as HTMLInputElement).value).toBe("40");
  expect((within(form).getByLabelText("Description") as HTMLInputElement).value).toBe("Dinner");
  expect((within(form).getByLabelText("Category") as HTMLSelectElement).value).toBe("dining");
  expect((within(form).getByLabelText("Trip") as HTMLSelectElement).value).toBe("");
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "55" } });
  fireEvent.change(within(form).getByLabelText("Trip"), { target: { value: "trip-lis" } });
  setDate(form, "2026-10-06");
  fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
  expect(written().foreignEntries).toEqual([expect.objectContaining({ id: DINNER.id, amount: 55, date: "2026-10-06", tripId: "trip-lis", description: "Dinner", category: "dining" })]);
  expect(screen.queryByRole("form", { name: "Edit entry" })).toBeNull();
});

it("an edit that doesn't make sense is refused with the approved reason, and saves nothing", () => {
  const { onChange } = show(base([EXCH], { foreignEntries: [DINNER] }));
  fireEvent.click(within(within(screen.getByRole("region", { name: "EUR cash" })).getAllByRole("listitem")[1]).getByRole("button", { name: "Edit entry" }));
  const form = screen.getByRole("form", { name: "Edit entry" });
  fireEvent.change(within(form).getByLabelText("Description"), { target: { value: " " } });
  fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
  expect(within(form).getByText("Enter the amount and a description.")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});

it("with no foreign cash: no sheet, and only the forms that start one", () => {
  show(base());
  expect(screen.queryByRole("region", { name: /cash$/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Record an exchange" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cash received" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Spend from foreign cash" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Change back" })).toBeNull();
});
