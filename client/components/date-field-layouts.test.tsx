// Session 20, item 2 (owner: "DD / MM / YYYY shows in full at desktop and
// mobile widths... check EVERY date field"). With its boxes at full width, a
// date field needs about 175px (the calendar button included). The live check
// measured every date field at 1280 and 390px: in a two-column row at phone
// width a field gets about 143-163px, and its calendar button spilled out. So:
//   - every two-column row that holds a date field stacks to one column below
//     the sm breakpoint (640px): `grid-cols-1 sm:grid-cols-2`;
//   - the edit sheet is narrow at every width (max-w-sm), so its Amount/Date
//     row is one column always.
// A date field not in a grid takes its row's whole width.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ThemeProvider } from "../contexts/ThemeContext";
import TripsScreen from "./screens/TripsScreen";
import ForeignCashPanel from "./ForeignCashPanel";
import InputPanel from "./InputPanel";
import EditTransactionSheet from "./EditTransactionSheet";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, todayISO, type LocalFinancials, type StoredTransaction } from "../lib/localData";
import { buildExchange, buildForeignEntry } from "../lib/foreignCash";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
afterEach(cleanup);

const nearestGrid = (el: Element) => { let n = el.parentElement; while (n && !n.classList.contains("grid")) n = n.parentElement; return n; };
const dateBoxes = (root: ParentNode = document) => [...root.querySelectorAll('input[placeholder="DD"]')].map((i) => i.parentElement!);
function stacksOnPhones(label: string) {
  const boxes = dateBoxes();
  expect(boxes.length, `${label}: a date field is shown`).toBeGreaterThan(0);
  for (const box of boxes) {
    const g = nearestGrid(box);
    if (!g) continue;
    const cls = [...g.classList];
    expect(cls.includes("grid-cols-2") && !cls.includes("grid-cols-1"), `${label}: a two-column row that doesn't stack`).toBe(false);
  }
}

const TRIP = { id: "trip-lis", name: "Lisbon", startDate: "2026-10-01", endDate: "2026-10-20", budgetUSD: 1200, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" };
const EXCH = buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500);
const D = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, lbpRateHistory: [], trips: [TRIP], transactions: [EXCH],
  foreignEntries: [buildForeignEntry({ kind: "spend", code: "EUR", amount: 40, date: "2026-10-05", description: "Dinner" })] } as LocalFinancials;

it("Trips: the new-trip and edit-trip Starts/Ends rows, and the card's spend form", () => {
  render(<ThemeProvider><TripsScreen financials={D} onChange={vi.fn()} /></ThemeProvider>);
  stacksOnPhones("new trip");
  const card = screen.getByRole("region", { name: "Lisbon" });
  fireEvent.click(within(card).getByRole("button", { name: "Edit trip" }));
  stacksOnPhones("edit trip");
  fireEvent.click(within(card).getByRole("button", { name: "Edit trip" }));
  fireEvent.click(within(card).getByRole("button", { name: "Spend from foreign cash" }));
  stacksOnPhones("the card's spend form");
});

it("Currency: spend, change back, cash received, and editing an entry", () => {
  render(<ThemeProvider><ForeignCashPanel financials={D} onChange={vi.fn()} /></ThemeProvider>);
  for (const btn of ["Spend from foreign cash", "Change back", "Cash received"]) {
    fireEvent.click(screen.getByRole("button", { name: btn }));
    stacksOnPhones(btn);
    fireEvent.click(screen.getByRole("button", { name: btn }));
  }
  fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
  stacksOnPhones("edit entry");
});

it("My Finances: the log form, a new goal, a new debt", () => {
  render(<InputPanel financials={D} dashData={computeDashboard(D)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
  stacksOnPhones("log an entry");
  cleanup();
  render(<InputPanel financials={D} dashData={computeDashboard(D)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
  fireEvent.click(screen.getByRole("button", { name: /Goals/ }));
  const goal = document.getElementById("new-goal-date")!.parentElement!;
  expect(nearestGrid(goal)!.classList.contains("grid-cols-1")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Debts/ }));
  const debt = document.getElementById("new-debt-opened")!.parentElement!;
  expect(nearestGrid(debt)!.classList.contains("grid-cols-1")).toBe(true);
});

it("the edit sheet: Amount and Date are one column at every width (the sheet is narrow everywhere)", () => {
  const t = { id: "t1", amount: 18, currency: "USD", bucket: "WANTS", description: "Lunch", date: todayISO() } as StoredTransaction;
  render(<ThemeProvider><EditTransactionSheet transaction={t} financials={{ ...D, transactions: [t] } as LocalFinancials} onChange={vi.fn()} onClose={vi.fn()} /></ThemeProvider>);
  const g = nearestGrid(dateBoxes()[0]);
  expect(g === null || ![...g.classList].some((c) => /grid-cols-[2-9]/.test(c))).toBe(true);
});
