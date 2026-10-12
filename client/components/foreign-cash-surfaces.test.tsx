// Foreign cash, model 2 (session 18, held; new wording DRAFT) on the screens
// that already exist.
//   - Net worth: slice 1's "Foreign cash (at cost): $X, not yet counted in
//     net worth" line is gone from the overview, Journey and the currency
//     screen's Cash & assets panel: euros were spent at the exchange.
//   - An exchange is one row: deleted, restored and removed alone.
//   - The transaction list says what an exchange or a change-back row is.
//   - The edit sheet: an exchange or change-back row edits like any row
//     (decision 6: amounts and date too), and its euros; an exchange stays
//     spending and a change-back stays income.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../contexts/ThemeContext";
import FinancialDashboard from "./FinancialDashboard";
import JourneyScreen from "./screens/JourneyScreen";
import CurrencyScreen from "./screens/CurrencyScreen";
import InputPanel from "./InputPanel";
import TransactionsScreen from "./screens/TransactionsScreen";
import EditTransactionSheet from "./EditTransactionSheet";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, todayISO, softDelete, type LocalFinancials, type StoredTransaction } from "../lib/localData";
import { buildExchange, buildChangeBack, buildForeignEntry } from "../lib/foreignCash";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const day = todayISO();
const exch = () => buildExchange({ date: day, paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500);
const back = () => buildChangeBack({ date: day, code: "EUR", given: 100, received: 105, receivedCurrency: "USD", to: { paymentMethod: "cash" }, description: "Changed back from EUR" }, 89_500);
const fin = (transactions: StoredTransaction[], extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, transactions, ...extra }) as LocalFinancials;
const withEuros = () => fin([exch()], { foreignEntries: [buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: day, description: "Dinner" })] });

describe("net worth: no 'not yet counted' line anywhere", () => {
  it("the overview", () => {
    const d = withEuros();
    render(<ThemeProvider><FinancialDashboard data={computeDashboard(d)} financials={d} onNavigate={vi.fn()} /></ThemeProvider>);
    expect(screen.queryByText(/not yet counted in net worth|Foreign cash \(at cost\)/)).toBeNull();
  });

  it("the currency screen's Cash & assets panel", () => {
    render(<ThemeProvider><CurrencyScreen financials={withEuros()} onChange={vi.fn()} /></ThemeProvider>);
    expect(screen.getByText("Cash & assets, by currency").parentElement!.textContent).not.toMatch(/not yet counted in net worth|Foreign cash \(at cost\)/);
  });

  it("Journey", () => {
    const d = withEuros();
    render(<ThemeProvider><JourneyScreen financials={d} dashData={computeDashboard(d)} onNavigate={vi.fn()} /></ThemeProvider>);
    expect(screen.queryByText(/not yet counted in net worth|Foreign cash \(at cost\)/)).toBeNull();
  });
});

describe("an exchange is one row", () => {
  it("Delete on My Finances deletes just it", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const e = exch();
    const other = { id: "o1", amount: 12, currency: "USD", bucket: "WANTS", description: "Coffee", date: day } as StoredTransaction;
    const d = fin([e, other]);
    const onChange = vi.fn();
    render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={onChange} onEdit={vi.fn()} onPay={vi.fn()} />);
    const buttons = screen.getAllByRole("button", { name: "Delete transaction" });
    fireEvent.click(buttons[0]);
    const written = (onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions;
    expect(written.filter((t) => t.deletedAt)).toHaveLength(1);
  });

  it("Recently deleted restores it, and removes it", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const d = fin([softDelete(fin([]), exch(), "2026-10-05T09:00:00.000Z")]);
    const onChange = vi.fn();
    render(<TransactionsScreen financials={d} onChange={onChange} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Recently deleted/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect((onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions.every((t) => !t.deletedAt)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect((onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions.every((t) => t.purgedAt)).toBe(true);
  });
});

it("the transaction list says what an exchange row and a change-back row are", () => {
  render(<TransactionsScreen financials={fin([exch(), back()])} onChange={vi.fn()} onEdit={vi.fn()} />);
  expect(screen.getByText("⇄ exchange · €460.00 received")).toBeTruthy();
  expect(screen.getByText("⇄ changed back · €100.00")).toBeTruthy();
  expect(screen.queryByText(/split payment|⇄ transfer/)).toBeNull();
});

describe("the edit sheet", () => {
  const open = (t: StoredTransaction) => {
    const onChange = vi.fn();
    render(<ThemeProvider><EditTransactionSheet transaction={t} financials={fin([t])} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    return { onChange, saved: () => (onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions.find((x) => x.id === t.id)! };
  };

  it("an exchange row: its amount, date and euros can change; it stays spending; slice 1's sentences are gone", () => {
    const e = exch();
    const { saved } = open(e);
    expect(screen.queryByText(/Part of an exchange|Spent from EUR cash/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Income/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Transfer/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "520" } });
    fireEvent.change(screen.getByLabelText("Amount received"), { target: { value: "470" } });
    fireEvent.change(screen.getByRole("dialog").querySelector('input[type="date"]')!, { target: { value: "2026-10-04" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(saved()).toMatchObject({ amount: 520, date: "2026-10-04", bucket: "WANTS", category: "travel", paymentMethod: "cash", fx: { code: "EUR", amount: 470, kind: "exchange" } });
  });

  it("a change-back row: its amounts can change and it stays income", () => {
    const b = back();
    const { saved } = open(b);
    expect(screen.queryByRole("button", { name: /Needs|Wants|Savings|Transfer/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Amount changed back"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(saved()).toMatchObject({ amount: 95, bucket: "INCOME", fx: { code: "EUR", amount: 90, kind: "back" } });
  });

  it("euros that aren't positive aren't saved", () => {
    const e = exch();
    const { onChange } = open(e);
    fireEvent.change(screen.getByLabelText("Amount received"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
