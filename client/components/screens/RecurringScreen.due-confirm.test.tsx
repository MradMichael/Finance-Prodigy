// U2 (owner, session 33, DECISIONS_PENDING 19 (a); existing texts): the reminder's "Review" leads to Recurring,
// which now says when each upcoming item is due, in the Overview chips' words, with their Confirm button.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import RecurringScreen from "./RecurringScreen";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring } from "../../lib/localData";
import type { computeDashboard } from "../../lib/computeDashboard";

afterEach(cleanup);

type Renewal = ReturnType<typeof computeDashboard>["upcomingRenewals"][number];
const rec = (id: string, name: string, over: Partial<StoredRecurring> = {}): StoredRecurring =>
  ({ id, name, emoji: "•", amount: 40, currency: "USD", frequency: "monthly", bucket: "WANTS", startDate: "2026-01-25", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z", ...over }) as StoredRecurring;
const renewal = (id: string, name: string, dueInDays: number, overdueCount = 0): Renewal =>
  ({ id, name, emoji: "•", amount: 40, currency: "USD", dueDate: "2026-10-31", dueInDays, overdueCount });

function show(renewals: Renewal[], onConfirm = vi.fn(), logging?: Set<string>, confirmed?: Set<string>) {
  // Rent starts far ahead: not upcoming, and not overdue either (an overdue item is always in the renewals list).
  const d = { ...DEFAULT_DATA, recurring: [rec("gym", "Gym"), rec("net", "Internet"), rec("rent", "Rent", { startDate: "2099-01-25" }), rec("ins", "Insurance")] } as LocalFinancials;
  render(<RecurringScreen financials={d} onEdit={vi.fn()} renewals={renewals} onConfirm={onConfirm} loggingIds={logging} justConfirmedIds={confirmed} />);
  return onConfirm;
}
const rowOf = (name: string) => screen.getByText(name, { exact: false, selector: "p" }).closest("div.flex.items-center") as HTMLElement;

describe("Recurring says what's due, with Confirm", () => {
  it("due today, tomorrow, in N days, and overdue: the chips' words, and Confirm on each", () => {
    show([renewal("net", "Internet", 0), renewal("rent", "Rent", 1), renewal("ins", "Insurance", 5), renewal("gym", "Gym", -6, 1)]);
    expect(within(rowOf("Internet")).getByText("· today")).toBeTruthy();
    expect(within(rowOf("Rent")).getByText("· tomorrow")).toBeTruthy();
    expect(within(rowOf("Insurance")).getByText("· in 5d")).toBeTruthy();
    expect(within(rowOf("Gym")).getByText("· 1 overdue")).toBeTruthy();
    for (const n of ["Internet", "Rent", "Insurance", "Gym"]) expect(within(rowOf(n)).getByRole("button", { name: "Confirm" })).toBeTruthy();
  });

  it("the due line replaces the old overdue badge, so it isn't said twice", () => {
    show([renewal("gym", "Gym", -6, 1)]);
    expect(within(rowOf("Gym")).queryByText(/^overdue/)).toBeNull();
  });

  it("Confirm calls the same handler as Renewing soon's, with the item's id", () => {
    const onConfirm = show([renewal("gym", "Gym", -6, 1)]);
    fireEvent.click(within(rowOf("Gym")).getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledWith("gym");
  });

  it("an item that isn't upcoming shows neither", () => {
    show([renewal("gym", "Gym", -6, 1)]);
    expect(within(rowOf("Rent")).queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(within(rowOf("Rent")).queryByText(/today|tomorrow|overdue|in \dd/)).toBeNull();
  });

  it("confirming and confirmed read as Renewing soon's do", () => {
    show([renewal("gym", "Gym", -6, 1), renewal("net", "Internet", 0)], vi.fn(), new Set(["gym"]), new Set(["net"]));
    expect(within(rowOf("Gym")).getByRole("button", { name: "Confirming…" })).toBeTruthy();
    expect(within(rowOf("Internet")).getByRole("button", { name: "Confirmed ✓" })).toBeTruthy();
  });
});
