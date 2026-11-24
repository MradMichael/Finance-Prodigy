// Owner, session 63, item 1: an empty category (only from an imported backup) is no category, on Categories and
// Transactions too: one "Uncategorized" row in "Where it went", holding the rows with none, the rows with an empty
// one, and this month's recurring items with an empty one (each screen adds those itself).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import CategoriesScreen from "./CategoriesScreen";
import TransactionsScreen from "./TransactionsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 24, 12, 0, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const TX = (id: string, amount: number, category?: string): StoredTransaction =>
  ({ id, amount, currency: "USD", bucket: "WANTS", description: id, date: "2026-11-10", paymentMethod: "cash", ...(category !== undefined ? { category } : {}) }) as StoredTransaction;
// A grandfathered item (its cut-over after this month), so each screen adds it to this month's figures itself.
const GYM = { id: "r1", name: "Gym", emoji: "G", amount: 40, currency: "USD", frequency: "monthly", bucket: "WANTS", category: "", startDate: "2026-01-01", endDate: null, confirmCutoverDate: "2027-06-30", createdAt: "2026-01-01T00:00:00.000Z" } as unknown as StoredRecurring;
const DATA = { ...DEFAULT_DATA, income: 3000, customCategories: [], categoryRules: [], transactions: [TX("none", 100), TX("empty", 50, ""), TX("dinner", 10, "dining")], recurring: [GYM] } as unknown as LocalFinancials;

/** The legend rows that read "Uncategorized", and each one's text. */
function uncategorizedRows(scope: HTMLElement): string[] {
  return within(scope).queryAllByText(/Uncategorized/).map((el) => el.parentElement?.textContent ?? "");
}

it("Categories, this month: one Uncategorized row, with the empty category and the recurring item in it", () => {
  render(<ThemeProvider><CategoriesScreen financials={DATA} onChange={vi.fn()} /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "This month" }));
  const rows = uncategorizedRows(document.body);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatch(/\$190/); // 100 + 50 + the item's 40
});

it("Transactions, By category: one Uncategorized row in Where it went, with both and the recurring item", () => {
  render(<ThemeProvider><TransactionsScreen financials={DATA} onChange={vi.fn()} onEdit={vi.fn()} /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "By category" }));
  const legend = screen.getByText(/Where it went/).parentElement!;
  const rows = uncategorizedRows(legend);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatch(/\$190/);
});
