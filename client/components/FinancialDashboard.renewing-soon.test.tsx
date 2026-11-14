// Session 52 (owner, R10): an overdue bill was said three times on the Overview: the reminder, Needs attention, and
// Renewing soon. It leaves Renewing soon, which lists what is coming up; the reminder and Needs attention still
// name it. The dashboard's upcomingRenewals is unchanged (the reminder reads it).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import FinancialDashboard from "./FinancialDashboard";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
vi.mock("../lib/auth", () => ({ getSession: () => null, getRecoveryTokenForSync: vi.fn(async () => null) }));
beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0), toFake: ["Date"] }); }); // 13 November 2026
afterEach(() => { cleanup(); vi.useRealTimers(); });

const rec = (id: string, name: string, startDate: string): StoredRecurring => ({
  id, name, emoji: "R", amount: 30, currency: "USD", bucket: "NEEDS", frequency: "monthly", startDate,
  confirmCutoverDate: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z",
}) as StoredRecurring;
// Gym was due on 5 November and isn't confirmed: overdue. Internet is due on 15 November: coming up.
const data = (recurring: StoredRecurring[]) => ({ ...DEFAULT_DATA, income: 3000, recurring, transactions: [] }) as LocalFinancials;

function show(recurring: StoredRecurring[]) {
  const d = data(recurring);
  const dash = computeDashboard(d);
  render(<FinancialDashboard data={dash} financials={d} onConfirmRecurring={vi.fn()} />);
  const label = screen.queryByText("Renewing soon");
  return { dash, list: label ? (label.parentElement as HTMLElement) : null };
}

describe("Renewing soon lists what is coming up, not what is overdue", () => {
  it("premise: the dashboard reports Gym overdue and Internet due in 2 days", () => {
    const { dash } = show([rec("r-gym", "Gym", "2026-11-05"), rec("r-net", "Internet", "2026-11-15")]);
    expect(dash.upcomingRenewals.map((r) => [r.name, r.overdueCount > 0, r.dueInDays])).toEqual([["Gym", true, -8], ["Internet", false, 2]]);
  });

  it("the overdue one isn't in the list; the one coming up is", () => {
    const { list } = show([rec("r-gym", "Gym", "2026-11-05"), rec("r-net", "Internet", "2026-11-15")]);
    expect(list).not.toBeNull();
    expect(within(list!).queryByText("Gym")).toBeNull();
    expect(within(list!).getByText("Internet")).toBeTruthy();
    expect(within(list!).queryByText(/overdue/)).toBeNull();
  });

  it("with only overdue items, the list isn't shown at all", () => {
    const { list } = show([rec("r-gym", "Gym", "2026-11-05")]);
    expect(list).toBeNull();
  });
});
