// TEST-02 (blind-spot audit, session 21): the Categories screen creates and
// renames categories and rules itself, and no test checked what it stored
// (its deletions and totals are covered elsewhere). These pin it: a new
// category is keyed by its name's slug, never colliding with one held; a
// rename changes the label and emoji, never the key every entry points at; a
// rule stores its keyword and category; applying it fills only entries with
// no category, never a choice already made.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import CategoriesScreen from "./CategoriesScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../../lib/localData";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function show(o: Partial<LocalFinancials> = {}) {
  const onChange = vi.fn<(f: LocalFinancials) => void>();
  const data = { ...DEFAULT_DATA, income: 3000, customCategories: [], categoryRules: [], transactions: [], recurring: [], ...o } as LocalFinancials;
  render(<ThemeProvider><CategoriesScreen financials={data} onChange={onChange} /></ThemeProvider>);
  return { onChange, last: () => onChange.mock.calls.at(-1)?.[0] as LocalFinancials };
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });

it("a new category is keyed by its name's slug, with the emoji given", () => {
  const { last } = show();
  type("Emoji", "🐾"); type("Name", "Pet care");
  fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
  expect(last().customCategories).toEqual([expect.objectContaining({ value: "pet-care", label: "Pet care", icon: "🐾" })]);
});

it("a name already taken gets the next free key, and a blank emoji falls back to the tag", () => {
  const { last } = show({ customCategories: [{ value: "pet-care", label: "Pet care", icon: "🐾" }] });
  type("Emoji", " "); type("Name", "Pet Care");
  fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
  expect(last().customCategories?.[1]).toMatchObject({ value: "pet-care-2", label: "Pet Care", icon: "🏷️" });
});

it("a rename changes the label and emoji, never the key", () => {
  const { last } = show({ customCategories: [{ value: "pet-care", label: "Pet care", icon: "🐾" }] });
  fireEvent.click(screen.getByRole("button", { name: "Edit Pet care category" }));
  // The add form's Name and Emoji are still on screen: the rename form's own, by id.
  fireEvent.change(document.getElementById("edit-cat-name")!, { target: { value: "Pets" } });
  fireEvent.change(document.getElementById("edit-cat-icon")!, { target: { value: "🐶" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(last().customCategories).toEqual([expect.objectContaining({ value: "pet-care", label: "Pets", icon: "🐶" })]);
});

it("a rule stores its keyword and category", () => {
  const { last } = show();
  type("Keyword", "Spinneys");
  fireEvent.change(screen.getByLabelText("Category", { exact: true }), { target: { value: "groceries" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Add rule" }));
  expect(last().categoryRules).toEqual([expect.objectContaining({ keyword: "Spinneys", category: "groceries" })]);
});

it("applying a rule fills only entries with no category, transactions and recurring items alike", () => {
  vi.spyOn(window, "alert").mockImplementation(() => {});
  const tx = (id: string, description: string, category?: string) => ({ id, amount: 20, currency: "USD", bucket: "NEEDS", description, date: "2026-10-01", ...(category ? { category } : {}) }) as StoredTransaction;
  const bare = tx("t1", "SPINNEYS ACHRAFIEH");
  const chosen = tx("t2", "Spinneys deli", "dining");
  const other = tx("t3", "Bakery");
  const sub = { id: "r1", name: "Spinneys delivery", emoji: "🛒", amount: 30, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" } as StoredRecurring;
  const { last } = show({ categoryRules: [{ id: "rule1", keyword: "spinneys", category: "groceries" }], transactions: [bare, chosen, other], recurring: [sub] });
  fireEvent.click(screen.getByRole("button", { name: "Apply to past" }));
  expect(last().transactions.map((t) => t.category)).toEqual(["groceries", "dining", undefined]);
  expect(last().recurring[0].category).toBe("groceries");
  expect(window.alert).toHaveBeenCalledWith("Categorized 2 existing entries.");
});
