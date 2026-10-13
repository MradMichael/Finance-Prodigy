// TEST-02 (blind-spot audit, session 21): the Recurring screen sums every
// item's monthly equivalent itself, and no test ran it (CUR-01's test covers
// My Finances' own total). These pin it: "Total committed monthly" is each
// item's monthly equivalent in dollars (weekly × 52/12, a lira item at the
// live rate), each bucket's subtotal likewise, and an item that has ended,
// or whose installments are all paid, counts nothing.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import RecurringScreen from "./RecurringScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 8, 21)); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

const rec = (o: Partial<StoredRecurring>): StoredRecurring => ({
  id: "r", name: "x", emoji: "🔁", amount: 0, currency: "USD", frequency: "monthly", bucket: "WANTS",
  startDate: "2026-01-15", endDate: null, totalAmount: null, createdAt: "2026-01-15T00:00:00.000Z", ...o,
});
const NETFLIX = rec({ id: "r-netflix", name: "Netflix", amount: 15 });
const GENERATOR = rec({ id: "r-gen", name: "Generator", amount: 1_790_000, currency: "LBP", bucket: "NEEDS" });
const GYM = rec({ id: "r-gym", name: "Gym", amount: 12, frequency: "weekly" });
const show = (recurring: StoredRecurring[], transactions: StoredTransaction[] = []) =>
  render(<ThemeProvider><RecurringScreen financials={{ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, recurring, transactions } as LocalFinancials} onEdit={() => {}} /></ThemeProvider>);
const total = () => screen.getByText("Total committed monthly").nextElementSibling?.textContent;
const subtotal = (bucket: string) => screen.getByText(bucket, { selector: "p" }).nextElementSibling?.textContent;

it("the total is each item's monthly equivalent in dollars: $15 + L£1,790,000 at 89,500 + $12 weekly is $15 + $20 + $52 = $87", () => {
  show([NETFLIX, GENERATOR, GYM]);
  expect(total()).toBe("$87");
});

it("each bucket's subtotal likewise", () => {
  show([NETFLIX, GENERATOR, GYM]);
  expect(subtotal("Needs")).toBe("$20/mo");
  expect(subtotal("Wants")).toBe("$67/mo");
});

it("an item that has ended counts nothing", () => {
  show([NETFLIX, rec({ id: "r-old", name: "Old plan", amount: 40, endDate: "2026-06-30" })]);
  expect(total()).toBe("$15");
});

it("an installment plan whose total is paid counts nothing", () => {
  const plan = rec({ id: "r-plan", name: "Phone", amount: 100, totalAmount: 300 });
  const paid = [1, 2, 3].map((i) => ({ id: `p${i}`, amount: 100, currency: "USD", bucket: "WANTS", description: "Phone", date: `2026-0${i + 5}-15`, recurringId: "r-plan" }) as StoredTransaction);
  show([NETFLIX, plan], paid);
  expect(total()).toBe("$15");
});
