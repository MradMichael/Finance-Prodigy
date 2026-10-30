// The in-app due-date reminder (owner's request, 2026-08-20; planned in
// session 30, wording approved and built in session 31). When a recurring
// item is due today or overdue, a banner asks whether it's paid. Yes uses the
// dashboard's own confirm (Renewing soon's Confirm), so it writes what Confirm
// writes; Not yet hides that item until the app is next opened, storing
// nothing. Several items collapse to a count with a way to the Recurring
// screen. In-app only: no notifications.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import DueReminder, { type Renewal } from "./DueReminder";
import { ThemeProvider } from "../contexts/ThemeContext";

afterEach(cleanup);

const item = (o: Partial<Renewal>): Renewal => ({ id: "r-rent", name: "Rent", emoji: "🏠", amount: 500, currency: "USD", dueDate: "2026-10-15", dueInDays: 0, overdueCount: 0, ...o });
const show = (renewals: Renewal[], o: { blocked?: boolean; onConfirm?: (id: string) => Promise<boolean>; onReview?: () => void } = {}) => {
  const onConfirm = o.onConfirm ?? vi.fn(async () => true);
  const onReview = o.onReview ?? vi.fn();
  const r = render(<ThemeProvider><DueReminder renewals={renewals} blocked={o.blocked ?? false} onConfirm={onConfirm} onReview={onReview} /></ThemeProvider>);
  return { ...r, onConfirm, onReview };
};

describe("when it shows, and what it says", () => {
  it("due today: \"{name} is due today ({amount}). Is it paid?\", in a region labelled \"Payment reminder\"", () => {
    show([item({})]);
    const region = screen.getByRole("region", { name: "Payment reminder" });
    expect(region.textContent).toContain("Rent is due today ($500.00). Is it paid?");
    expect(screen.getByRole("button", { name: "Yes, it's paid" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not yet" })).toBeTruthy();
  });

  it("one payment overdue: \"{name} was due on {date} ({amount}). Is it paid?\"", () => {
    show([item({ dueDate: "2026-10-12", dueInDays: -3, overdueCount: 1 })]);
    expect(screen.getByRole("region", { name: "Payment reminder" }).textContent).toContain("Rent was due on 12/10/2026 ($500.00). Is it paid?");
  });

  it("several cycles of one item outstanding: the oldest, by date", () => {
    show([item({ dueDate: "2026-08-15", dueInDays: -61, overdueCount: 3 })]);
    expect(screen.getByRole("region", { name: "Payment reminder" }).textContent).toContain("Rent has 3 payments outstanding, the oldest due on 15/08/2026. Is that one paid?");
  });

  it("a lira item reads in lira", () => {
    show([item({ name: "Generator", amount: 2_500_000, currency: "LBP" })]);
    expect(screen.getByRole("region", { name: "Payment reminder" }).textContent).toContain("Generator is due today (L£2,500,000). Is it paid?");
  });

  it("nothing for an item due tomorrow, or with nothing due", () => {
    const { container } = show([item({ dueDate: "2026-10-16", dueInDays: 1 })]);
    expect(screen.queryByRole("region", { name: "Payment reminder" })).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("nothing while another prompt is on screen (blocked)", () => {
    show([item({})], { blocked: true });
    expect(screen.queryByRole("region", { name: "Payment reminder" })).toBeNull();
  });

  it("several items: \"{n} payments are due or overdue.\" and Review, which goes to the Recurring screen", () => {
    const { onReview } = show([item({}), item({ id: "r-gym", name: "Gym", amount: 20, dueDate: "2026-10-10", dueInDays: -5, overdueCount: 1 }), item({ id: "r-tv", name: "TV", dueInDays: 3, dueDate: "2026-10-18" })]);
    expect(screen.getByRole("region", { name: "Payment reminder" }).textContent).toContain("2 payments are due or overdue.");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});

describe("Yes and Not yet", () => {
  it("Yes confirms that item through the given handler, then says \"Logged {name}, {amount}.\"", async () => {
    const { onConfirm } = show([item({})]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, it's paid" }));
    await waitFor(() => expect(screen.getByText("Logged Rent, $500.00.")).toBeTruthy());
    expect(onConfirm).toHaveBeenCalledWith("r-rent");
  });

  it("a Yes that isn't stored says nothing was logged (no \"Logged\")", async () => {
    show([item({})], { onConfirm: vi.fn(async () => false) });
    fireEvent.click(screen.getByRole("button", { name: "Yes, it's paid" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/^Logged /)).toBeNull();
  });

  it("Not yet hides that item for the page's life; a new mount (the next open) brings it back; nothing is stored", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const first = show([item({})]);
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(screen.queryByRole("region", { name: "Payment reminder" })).toBeNull();
    first.rerender(<ThemeProvider><DueReminder renewals={[item({ amount: 500 })]} blocked={false} onConfirm={first.onConfirm} onReview={first.onReview} /></ThemeProvider>);
    expect(screen.queryByRole("region", { name: "Payment reminder" })).toBeNull(); // the same page: still hidden
    cleanup();
    show([item({})]);
    expect(screen.getByRole("region", { name: "Payment reminder" })).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("the count line offers Review only (no Yes, no Not yet: which item would they answer?)", () => {
    show([item({}), item({ id: "r-gym", name: "Gym", amount: 20, dueDate: "2026-10-10", dueInDays: -5, overdueCount: 1 })]);
    expect(screen.getByRole("region", { name: "Payment reminder" }).textContent).toContain("2 payments are due or overdue.");
    expect(screen.queryByRole("button", { name: "Not yet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Yes, it's paid" })).toBeNull();
  });
});
