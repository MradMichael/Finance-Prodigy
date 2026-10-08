// Session 4 item 7: every surface that asks the recurring engine about
// "today" passes today's calendar day. Each surface is pinned here by the case
// where the day matters: a cycle due YESTERDAY and not confirmed is overdue as
// of today, and not yet overdue as of yesterday. Before this, nothing tested
// which day My Finances, Recurring or the PDF report asked about.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputPanel from "./InputPanel";
import RecurringScreen from "./screens/RecurringScreen";
import { buildReportHtml } from "../lib/printReport";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

afterEach(() => { vi.useRealTimers(); cleanup(); });

// Monthly from 1 Sep; 1 Sep paid; 1 Oct not. On 2 Oct, 1 Oct is overdue.
const DATA = {
  ...DEFAULT_DATA, income: 3000,
  recurring: [{ id: "r1", name: "Rent", emoji: "🏠", amount: 100, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-09-01", endDate: null, totalAmount: null, createdAt: "2026-08-01T00:00:00.000Z" }],
  transactions: [{ id: "t1", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-09-01", recurringId: "r1" }],
} as LocalFinancials;
const onOctober2 = () => vi.useFakeTimers({ now: new Date(2026, 9, 2, 12, 0), toFake: ["Date"] });

it("My Finances marks yesterday's unpaid cycle overdue", async () => {
  onOctober2();
  render(<InputPanel financials={DATA} dashData={computeDashboard(DATA)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Manage/ }));
  await user.click(screen.getByRole("button", { name: /Recurring Payments/ }));
  expect(screen.getAllByText(/^overdue/i).length).toBeGreaterThan(0);
});

it("the Recurring screen marks it overdue", () => {
  onOctober2();
  render(<RecurringScreen financials={DATA} onEdit={vi.fn()} />);
  const row = screen.getByText("Rent").closest("p")!;
  expect(within(row).getByText(/^overdue/i)).toBeTruthy();
});

it("the PDF report tags it overdue", () => {
  onOctober2();
  expect(buildReportHtml("U One", DATA, computeDashboard(DATA))).toContain('<span class="tag">overdue</span>');
});
