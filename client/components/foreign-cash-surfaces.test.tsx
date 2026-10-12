// Travel slice 1: foreign cash on the screens that already exist.
//   - Net worth: the owner's line, "Foreign cash (at cost): $X, not yet
//     counted in net worth", on the overview's Net worth panel and on
//     Journey's, so an exchange never looks like money vanished. Net worth
//     itself leaves foreign cash out, as it leaves out tracked balances
//     (DI-06): counting it would make an exchange look like money appeared.
//   - Delete on My Finances deletes an exchange's two rows together.
//   - Recently deleted restores, and removes, an exchange's two rows together.
//   - The transaction list says what an exchange row or a pocket spend is.
//   - The edit sheet keeps what would break them: an exchange row changes
//     only its description and category; a spend can't change its amount,
//     currency or payment method, nor become income or a transfer.
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
import { buildExchange, buildPocketSpend } from "../lib/foreignCash";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const LINE = "Foreign cash (at cost): $500, not yet counted in net worth";
const day = todayISO();
const legs = () => buildExchange({ date: day, paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500);
const fin = (transactions: StoredTransaction[], extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, transactions, ...extra }) as LocalFinancials;

describe("net worth", () => {
  it("the overview's Net worth panel carries the line, and net worth itself doesn't count it", () => {
    const d = fin(legs());
    render(<ThemeProvider><FinancialDashboard data={computeDashboard(d)} financials={d} onNavigate={vi.fn()} /></ThemeProvider>);
    expect(screen.getByText(LINE)).toBeTruthy();
    expect(computeDashboard(d).netWorth.total).toBe(computeDashboard(fin([])).netWorth.total);
  });

  it("the currency screen's Cash & assets panel carries it too, on its own line (owner, session 15)", () => {
    const d = fin(legs());
    render(<ThemeProvider><CurrencyScreen financials={d} onChange={vi.fn()} /></ThemeProvider>);
    const panel = screen.getByText("Cash & assets, by currency").parentElement!;
    expect(panel.textContent).toContain(LINE);
    cleanup();
    render(<ThemeProvider><CurrencyScreen financials={fin([])} onChange={vi.fn()} /></ThemeProvider>);
    expect(screen.getByText("Cash & assets, by currency").parentElement!.textContent).not.toMatch(/Foreign cash \(at cost\)/);
  });

  it("Journey's net worth carries it too; with no foreign cash, neither shows a line", () => {
    const d = fin(legs());
    render(<ThemeProvider><JourneyScreen financials={d} dashData={computeDashboard(d)} onNavigate={vi.fn()} /></ThemeProvider>);
    expect(screen.getByText(LINE)).toBeTruthy();
    cleanup();
    const none = fin([]);
    render(<ThemeProvider><FinancialDashboard data={computeDashboard(none)} financials={none} onNavigate={vi.fn()} /></ThemeProvider>);
    expect(screen.queryByText(/Foreign cash \(at cost\)/)).toBeNull();
  });
});

describe("an exchange's two rows go together", () => {
  it("Delete on My Finances deletes both", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const [src, pocket] = legs();
    const d = fin([src, pocket]);
    const onChange = vi.fn();
    render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={onChange} onEdit={vi.fn()} onPay={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete transaction" })[0]);
    const written = (onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions;
    expect(written.filter((t) => t.deletedAt).map((t) => t.id).sort()).toEqual([src.id, pocket.id].sort());
  });

  it("Recently deleted restores both, and removes both", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const [src, pocket] = legs();
    const at = "2026-10-05T09:00:00.000Z";
    const d = fin([softDelete(fin([]), src, at), softDelete(fin([]), pocket, at)]);
    const onChange = vi.fn();
    render(<TransactionsScreen financials={d} onChange={onChange} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Recently deleted/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[0]);
    expect((onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions.every((t) => !t.deletedAt)).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete permanently" })[0]);
    expect((onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions.every((t) => t.purgedAt)).toBe(true);
  });
});

describe("the transaction list", () => {
  it("says what an exchange row and a pocket spend are", () => {
    const [src, pocket] = legs();
    const s = buildPocketSpend({ date: day, code: "EUR", amount: 40, bucket: "WANTS", description: "Dinner", costPerUnitUSD: 500 / 460 });
    render(<TransactionsScreen financials={fin([src, pocket, s])} onChange={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText("⇄ exchange · €460.00 received")).toBeTruthy();
    expect(screen.getByText("⇄ exchange to EUR")).toBeTruthy();
    expect(screen.getByText("€40.00 from EUR cash")).toBeTruthy();
    expect(screen.queryByText(/split payment/)).toBeNull();
  });
});

describe("the edit sheet", () => {
  const open = (t: StoredTransaction, all: StoredTransaction[]) => {
    const onChange = vi.fn();
    render(<ThemeProvider><EditTransactionSheet transaction={t} financials={fin(all)} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    return { onChange, saved: () => (onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions.find((x) => x.id === t.id)! };
  };

  it("an exchange row: only description and category change; amount, date, bucket and payment method are kept", () => {
    const [src, pocket] = legs();
    const { saved } = open(src, [src, pocket]);
    expect(screen.getByText("Part of an exchange: only its description and category can change here. To change an amount or date, delete it and enter it again.")).toBeTruthy();
    expect(screen.queryByLabelText("Amount")).toBeNull();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Euros for Lisbon" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(saved()).toEqual({ ...src, description: "Euros for Lisbon", category: undefined, updatedAt: saved().updatedAt });
  });

  it("a pocket spend: its amount, currency and payment method are kept, and it can't become income or a transfer", () => {
    const s = buildPocketSpend({ date: day, code: "EUR", amount: 40, bucket: "WANTS", description: "Dinner", costPerUnitUSD: 500 / 460 });
    const { saved } = open(s, [s]);
    expect(screen.getByText("Spent from EUR cash: €40.00 at $1.0870 per €1. To change the amount, delete it and enter it again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Income/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Transfer/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Needs/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    const out = saved();
    expect(out).toMatchObject({ amount: s.amount, currency: "USD", bucket: "NEEDS", fx: s.fx });
    expect(out.paymentMethod).toBeUndefined();
  });
});
