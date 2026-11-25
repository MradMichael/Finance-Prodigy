// TODO 121 (owner, session 63, item 2), reproduced on main before any change: a recurring bill that is also logged
// by hand is asked about anyway, and "Yes, it's paid" logs it a second time. Nothing links a hand-logged row to a
// cycle: a cycle counts as paid only through a row carrying the item's recurringId and the cycle's day
// (confirmedCycles). This file uses only what main already has, and stays true after the fix: "Yes" still logs a
// new row, by design; the fix adds "Already logged" beside it (DueReminder.already-logged.test.tsx).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import DueReminder from "./DueReminder";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, buildRecurringConfirmLog, nextConfirmTarget, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../lib/localData";
import { todayCalendarDay } from "../lib/calendarDay";
import { totalSpent } from "../lib/spending";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 24, 12, 0, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

// "Add to Recurring" after October's payment (session 62's start rule): first due 24 Nov.
const NETFLIX = { id: "r-netflix", name: "Netflix", emoji: "📺", amount: 15, currency: "USD", frequency: "monthly", bucket: "WANTS", startDate: "2026-11-24", endDate: null, totalAmount: null, createdAt: "2026-10-24T18:00:00.000Z" } as StoredRecurring;
const row = (id: string, date: string): StoredTransaction => ({ id, amount: 15, currency: "USD", bucket: "WANTS", description: "Netflix", date, paymentMethod: "card", createdAt: `${date}T09:00:00.000Z` });
const DATA = { ...DEFAULT_DATA, income: 3000, recurring: [NETFLIX], transactions: [row("oct", "2026-10-24"), row("nov", "2026-11-22")] } as LocalFinancials;
const november = (d: LocalFinancials) => d.transactions.filter((t) => t.date >= "2026-11-01" && t.date <= "2026-11-30");

it("November's Netflix, logged by hand on 22 Nov, is still asked about on its due day", () => {
  const renewal = computeDashboard(DATA).upcomingRenewals.find((r) => r.id === "r-netflix");
  expect(renewal).toMatchObject({ dueDate: "2026-11-24", dueInDays: 0, overdueCount: 0 });
  render(<ThemeProvider><DueReminder renewals={[renewal!]} blocked={false} onConfirm={vi.fn(async () => true)} onReview={vi.fn()} /></ThemeProvider>);
  const region = screen.getByRole("region", { name: "Payment reminder" });
  expect(region.textContent).toContain("Netflix is due today ($15.00). Is it paid?");
  expect(within(region).getAllByRole("button").map((b) => b.textContent)).toEqual(["Yes, it's paid", "Not yet"]);
});

it("\"Yes, it's paid\" (the page's confirm: nextConfirmTarget, then buildRecurringConfirmLog) logs a second November row", () => {
  const target = nextConfirmTarget(NETFLIX, DATA.transactions, DATA, todayCalendarDay());
  const { tx } = buildRecurringConfirmLog(NETFLIX, 89_500, target!.dueDate);
  const after = { ...DATA, transactions: [tx, ...DATA.transactions] } as LocalFinancials;
  expect(november(after).map((t) => [t.description, t.date, t.recurringId ?? null])).toEqual([["Netflix", "2026-11-24", "r-netflix"], ["Netflix", "2026-11-22", null]]);
  expect(totalSpent(november(after), (t) => t.amount)).toBe(30); // one $15 bill, counted twice
  expect(nextConfirmTarget(NETFLIX, after.transactions, after, todayCalendarDay())!.dueDate.toISOString().slice(0, 10)).toBe("2026-12-24");
});
