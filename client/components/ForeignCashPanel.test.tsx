// Travel slice 1 (HELD; new wording DRAFT): the currency screen's foreign cash.
//   - Record an exchange: the pool it came from, what was paid (USD or LBP),
//     the currency and amount received, and the date, which can be past. The
//     rate obtained is shown before saving. Two linked rows are added.
//   - Each pocket shows its balance, its cost, and its average cost.
//   - Spend from it: the cost in USD is shown before saving, at the pocket's
//     average on the spend's date; with no price, the form asks what a unit
//     cost. One ordinary USD row is added, at that frozen cost.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import ForeignCashPanel from "./ForeignCashPanel";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";
import { buildExchange } from "../lib/foreignCash";

afterEach(cleanup);
const base = (transactions: StoredTransaction[] = []) => ({ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions }) as LocalFinancials;
const exchanged = () => base(buildExchange({ date: "2026-10-02", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500));
function show(d: LocalFinancials) {
  const onChange = vi.fn();
  const view = render(<ThemeProvider><ForeignCashPanel financials={d} onChange={onChange} /></ThemeProvider>);
  return { onChange, view, written: () => onChange.mock.calls.at(-1)![0] as LocalFinancials };
}
const setDate = (form: HTMLElement, iso: string) => fireEvent.change(form.querySelector('input[type="date"]')!, { target: { value: iso } });

it("records an exchange on a past date: the rate is shown first, then two linked rows", () => {
  const { written } = show(base());
  fireEvent.click(screen.getByRole("button", { name: "Record an exchange" }));
  const form = screen.getByRole("form", { name: "Record an exchange" });
  setDate(form, "2026-10-02");
  fireEvent.click(within(form).getByRole("button", { name: /Cash/ }));
  fireEvent.change(within(form).getByLabelText("Amount paid"), { target: { value: "500" } });
  fireEvent.change(within(form).getByLabelText("Amount received"), { target: { value: "460" } });
  expect(within(form).getByText("You got €0.92 per $1 ($1.0870 per €1).")).toBeTruthy();
  fireEvent.click(within(form).getByRole("button", { name: "Save exchange" }));
  const rows = written().transactions;
  expect(rows).toHaveLength(2);
  const src = rows.find((t) => t.amount < 0)!, pocket = rows.find((t) => t.amount > 0)!;
  expect(src).toMatchObject({ amount: -500, currency: "USD", bucket: "TRANSFER", paymentMethod: "cash", date: "2026-10-02", description: "Exchange to EUR" });
  expect(pocket).toMatchObject({ amount: 500, currency: "USD", bucket: "TRANSFER", date: "2026-10-02", fx: { code: "EUR", amount: 460, kind: "in" } });
  expect(pocket.linkedPaymentId).toBe(src.linkedPaymentId);
});

it("refuses a code that isn't three letters, or USD or LBP, and amounts that aren't positive", () => {
  const { onChange } = show(base());
  fireEvent.click(screen.getByRole("button", { name: "Record an exchange" }));
  const form = screen.getByRole("form", { name: "Record an exchange" });
  fireEvent.change(within(form).getByLabelText("Amount paid"), { target: { value: "500" } });
  fireEvent.change(within(form).getByLabelText("Amount received"), { target: { value: "460" } });
  fireEvent.change(within(form).getByLabelText("Currency received"), { target: { value: "USD" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save exchange" }));
  expect(within(form).getByText("Use a three-letter currency code other than USD or LBP, like EUR.")).toBeTruthy();
  fireEvent.change(within(form).getByLabelText("Currency received"), { target: { value: "eur" } });
  fireEvent.change(within(form).getByLabelText("Amount received"), { target: { value: "" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save exchange" }));
  expect(within(form).getByText("Enter both amounts.")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});

it("shows each pocket: its balance, what it cost, and the average cost", () => {
  show(exchanged());
  expect(screen.getByText("EUR cash: €460.00")).toBeTruthy();
  expect(screen.getByText("Cost $500.00 · $1.0870 per €1")).toBeTruthy();
});

it("a spend shows its cost first, then adds one USD row at that frozen cost, in the bucket chosen", () => {
  const { written } = show(exchanged());
  fireEvent.click(screen.getByRole("button", { name: "Spend from foreign cash" }));
  const form = screen.getByRole("form", { name: "Spend from foreign cash" });
  setDate(form, "2026-10-03");
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "40" } });
  fireEvent.change(within(form).getByLabelText("Description"), { target: { value: "Dinner in Lisbon" } });
  fireEvent.click(within(form).getByRole("button", { name: /Wants/ }));
  expect(within(form).getByText("Counts as $43.48 ($1.0870 per €1).")).toBeTruthy();
  fireEvent.click(within(form).getByRole("button", { name: "Save spend" }));
  const added = written().transactions.find((t) => t.fx?.kind === "spend")!;
  expect(added).toMatchObject({ amount: 43.48, currency: "USD", bucket: "WANTS", date: "2026-10-03", description: "Dinner in Lisbon", fx: { code: "EUR", amount: 40, kind: "spend" } });
  expect(added.paymentMethod).toBeUndefined();
});

it("with no price for the date, the form asks what one unit cost, and uses it", () => {
  const { written } = show(exchanged());
  fireEvent.click(screen.getByRole("button", { name: "Spend from foreign cash" }));
  const form = screen.getByRole("form", { name: "Spend from foreign cash" });
  setDate(form, "2026-09-20"); // before the only exchange
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "10" } });
  fireEvent.change(within(form).getByLabelText("Description"), { target: { value: "Taxi" } });
  fireEvent.change(within(form).getByLabelText("What did €1 cost you, in $?"), { target: { value: "1.1" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save spend" }));
  expect(written().transactions.find((t) => t.fx?.kind === "spend")).toMatchObject({ amount: 11, fx: { amount: 10, costPerUnitUSD: 1.1 } });
});
