// HELD (owner, session 34: "This month on a phone: latest 20 with 'Show all' (draft the label if new; hold only
// that)"). "Show all" is new wording, drafted and held. Below md, My Finances' This month shows its first 20
// entries (the list is newest entered first) and "Show all" for the rest; from md up nothing changes.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-25T12:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const row = (i: number): StoredTransaction =>
  ({ id: `t${i}`, amount: 10 + i, currency: "USD", bucket: "NEEDS", category: "groceries", description: `Entry ${i}`, date: "2026-10-20", paymentMethod: "cash" }) as StoredTransaction;
const panel = (n: number) => {
  const d = { ...DEFAULT_DATA, income: 3000, transactions: Array.from({ length: n }, (_, i) => row(i + 1)) } as LocalFinancials;
  render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
};
const hiddenOnPhone = (name: string) => (screen.getByText(name).closest("div[data-month-entry]") as HTMLElement).className.split(/\s+/).includes("max-md:hidden");

it("25 entries: the first 20 show on a phone, the rest wait for Show all", () => {
  panel(25);
  expect(hiddenOnPhone("Entry 1")).toBe(false);
  expect(hiddenOnPhone("Entry 20")).toBe(false);
  expect(hiddenOnPhone("Entry 21")).toBe(true);
  expect(hiddenOnPhone("Entry 25")).toBe(true);
  const button = screen.getByRole("button", { name: "Show all" });
  expect(button.className.split(/\s+/)).toContain("md:hidden"); // from md up the box scrolls, as before
});

it("Show all shows every entry, and goes away", () => {
  panel(25);
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  expect(hiddenOnPhone("Entry 25")).toBe(false);
  expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
});

it("20 or fewer: nothing hidden, no button", () => {
  panel(20);
  expect(hiddenOnPhone("Entry 20")).toBe(false);
  expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
});
