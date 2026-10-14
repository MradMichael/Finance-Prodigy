// Session 22, item 1 (owner's answer; HELD): a custom category added before
// the no-shared-label rule can still carry a built-in's label, e.g. a custom
// "Shopping" beside the built-in one. Its stored data stays as it is (no
// rename, no migration). On screen it reads "Shopping (custom)" (owner's
// wording) wherever labels show: the pickers, the trip category view, the
// report. Built-ins, and custom categories with no clash, read as before.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import CategoryOptions from "./form/CategoryOptions";
import TripsScreen from "./screens/TripsScreen";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, categoryLabel, type CustomCategory, type LocalFinancials, type StoredTransaction } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { buildReportHtml } from "../lib/printReport";
import type { StoredTrip } from "../lib/trips";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const MINE: CustomCategory[] = [
  { value: "shopping-2", label: "Shopping", icon: "🧺" },
  { value: "pet-care", label: "Pet care", icon: "🐾" },
];
const PARIS: StoredTrip = { id: "paris", name: "Paris", startDate: "2026-10-01", endDate: "2026-10-10", budgetUSD: 1000, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const spend = (id: string, category: string, amount: number) => ({ id, amount, currency: "USD", bucket: "WANTS", category, description: id, date: "2026-10-03", paymentMethod: "card", tripId: "paris" }) as StoredTransaction;
const data = { ...DEFAULT_DATA, income: 3000, customCategories: MINE, trips: [PARIS], transactions: [spend("mine", "shopping-2", 20), spend("built-in", "shopping", 30)] } as LocalFinancials;

it("the label: the clashing custom one is marked, the built-in and an unclashing custom one aren't", () => {
  expect(categoryLabel("shopping-2", MINE)).toBe("Shopping (custom)");
  expect(categoryLabel("shopping", MINE)).toBe("Shopping");
  expect(categoryLabel("pet-care", MINE)).toBe("Pet care");
  expect(categoryLabel("shopping-2", [{ value: "shopping-2", label: " shopping ", icon: "🧺" }])).toBe("shopping (custom)");
});

it("the stored data isn't touched", () => {
  categoryLabel("shopping-2", MINE);
  expect(MINE[0].label).toBe("Shopping");
});

it("in a picker, no two options read the same", () => {
  render(<select aria-label="Category"><CategoryOptions customCategories={MINE} /></select>);
  const texts = within(screen.getByRole("combobox", { name: "Category" })).getAllByRole("option").map((o) => o.textContent);
  expect(texts).toContain("🧺 Shopping (custom)");
  expect(texts).toContain("🛍️ Shopping");
  expect(texts.filter((t, i) => texts.indexOf(t) !== i)).toEqual([]);
});

it("in the trip category view", () => {
  render(<ThemeProvider><TripsScreen financials={data} onChange={vi.fn()} /></ThemeProvider>);
  const card = screen.getByRole("region", { name: "Paris" });
  expect(within(card).getByText("Shopping (custom): $20.00")).toBeTruthy();
  expect(within(card).getByText("Shopping: $30.00")).toBeTruthy();
});

it("in the report", () => {
  const html = buildReportHtml("Quartz", data, computeDashboard(data), { detailed: true });
  expect(html).toContain("<td>Shopping (custom)</td>");
  expect(html).toContain("<td>Shopping</td>");
});
