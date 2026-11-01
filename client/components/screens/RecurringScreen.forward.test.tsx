// HELD (owner, session 33, DECISIONS_PENDING 19 and 25: P3-C, built with U2; wording drafted): Recurring
// shows the next 12 months of commitments -- what's committed each month, and what starts or ends in it.
// "Ends" is capacityFreedFrom's month, Projections' own source.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import RecurringScreen from "./RecurringScreen";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-31T10:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const rec = (over: Partial<StoredRecurring>): StoredRecurring => ({ id: "r", name: "R", emoji: "•", amount: 100, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2025-11-01", endDate: null, totalAmount: null, createdAt: "2025-11-01T00:00:00.000Z", ...over });
const paid = (m: string): StoredTransaction => ({ id: `u${m}`, amount: 750, currency: "USD", bucket: "NEEDS", description: "University installment", date: `2026-${m}-01`, paymentMethod: "cash", recurringId: "uni", cycleDate: `2026-${m}-01` });

it("each month's committed total, with what starts and ends in it", () => {
  const d = { ...DEFAULT_DATA, recurring: [
    rec({ id: "rent", name: "Rent", amount: 500 }),
    rec({ id: "uni", name: "University installment", amount: 750, startDate: "2026-08-01", totalAmount: 6750 }),
    rec({ id: "gym", name: "Gym", amount: 40, bucket: "WANTS", startDate: "2027-01-25" }),
    // A yearly bill ($35/mo), a lira one ($25/mo at today's rate), and one starting on the 1st (the boundary).
    rec({ id: "ins", name: "Car insurance", amount: 420, frequency: "yearly" }),
    rec({ id: "edl", name: "EDL", amount: 2_237_500, currency: "LBP" }),
    rec({ id: "phone", name: "Phone plan", amount: 20, startDate: "2027-03-01" }),
  ], transactions: ["08", "09", "10"].map(paid) } as LocalFinancials;
  render(<RecurringScreen financials={d} onEdit={vi.fn()} />);
  const section = screen.getByRole("heading", { name: "The next 12 months" }).parentElement!;
  const row = (label: string) => within(section).getByText(label, { exact: false }).closest("li")!.textContent!;
  expect(row("Oct 2026:")).toContain("Oct 2026: $1,310 committed");
  expect(row("Dec 2026:")).toContain("$1,310 committed");
  expect(row("Jan 2027:")).toContain("Jan 2027: $1,350 committed");
  expect(row("Jan 2027:")).toContain("Gym starts");
  expect(row("Feb 2027:")).not.toContain("Phone plan");
  expect(row("Mar 2027:")).toContain("Mar 2027: $1,370 committed");
  expect(row("Mar 2027:")).toContain("Phone plan starts");
  expect(row("May 2027:")).toContain("May 2027: $620 committed");
  expect(row("May 2027:")).toContain("University installment ends");
  expect(row("Apr 2027:")).not.toContain("ends");
  expect(within(section).getAllByRole("listitem")).toHaveLength(12);
});
