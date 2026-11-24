// Session 62 (owner: all drafted wording approved; FIX_PLANS session 61, item 3): "Bills you log by hand" on the
// Recurring screen. Every sentence checked verbatim.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import RecurringScreen from "./RecurringScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-24T12:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

let n = 0;
const internet = (date: string): StoredTransaction =>
  ({ id: `t${n++}`, amount: 35, currency: "USD", bucket: "NEEDS", category: "utilities", description: "Internet (IDM)", date, paymentMethod: "cash", createdAt: `${date}T09:00:00.000Z` }) as StoredTransaction;
const BILLS = ["2026-08-02", "2026-09-02", "2026-10-01", "2026-11-02"].map(internet);
const start = (transactions: StoredTransaction[]) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, transactions, recurring: [] }) as LocalFinancials;

let latest: LocalFinancials;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <ThemeProvider><RecurringScreen financials={d} onEdit={vi.fn()} onChange={setD} /></ThemeProvider>;
}
const card = () => screen.getByRole("heading", { name: "Bills you log by hand" }).closest("section")!;

it("the card: its heading, the lead, each bill with its amount and last payment, and both buttons", () => {
  render(<Harness initial={start(BILLS)} />);
  const c = card();
  expect(c.textContent).toContain("These came up about once a month for the last few months. Add one as recurring and ESSA will remind you when it's due.");
  expect(c.textContent).toContain("Internet (IDM)");
  expect(c.textContent).toContain("About $35.00 a month, last on 02/11/2026.");
  expect(within(c).getByRole("button", { name: "Add as recurring" })).toBeTruthy();
  expect(within(c).getByRole("button", { name: "Not a bill" })).toBeTruthy();
  // Shown above the empty state when there are no recurring items yet.
  expect(screen.getByText("No recurring items yet. Add them in My Finances.")).toBeTruthy();
});

it("Add as recurring: the item is made, and in its place: \"Internet (IDM) is now recurring. First due 02/12/2026.\"", () => {
  render(<Harness initial={start(BILLS)} />);
  fireEvent.click(within(card()).getByRole("button", { name: "Add as recurring" }));
  expect(latest.recurring).toHaveLength(1);
  expect(latest.recurring[0]).toMatchObject({ name: "Internet (IDM)", amount: 35, startDate: "2026-12-02" });
  expect(card().textContent).toContain("Internet (IDM) is now recurring. First due 02/12/2026.");
  expect(within(card()).queryByRole("button", { name: "Add as recurring" })).toBeNull();
});

it("Not a bill: \"Internet (IDM) won't be suggested again.\" with Undo, which brings it back", () => {
  render(<Harness initial={start(BILLS)} />);
  fireEvent.click(within(card()).getByRole("button", { name: "Not a bill" }));
  expect(latest.billHintsSetAside).toEqual(["internet (idm)|USD"]);
  expect(card().textContent).toContain("Internet (IDM) won't be suggested again.");
  fireEvent.click(within(card()).getByRole("button", { name: "Undo" }));
  expect(latest.billHintsSetAside).toEqual([]);
  expect(within(card()).getByRole("button", { name: "Add as recurring" })).toBeTruthy();
});

it("no bill logged by hand: no card", () => {
  render(<Harness initial={start(BILLS.slice(2))} />);
  expect(screen.queryByRole("heading", { name: "Bills you log by hand" })).toBeNull();
});
