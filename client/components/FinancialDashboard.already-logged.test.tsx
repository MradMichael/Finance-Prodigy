// TODO 124 (owner, session 64, item 3): the reminder's "Already logged" choice on the Overview's "Renewing soon"
// chips, with the sentences approved for the reminder (lib/alreadyLogged.ts, LOGGED_TEXT). A chip whose cycle has an
// entry logged by hand names it, "Already logged" leads (filled) and Confirm is outlined; Already logged links the
// entry instead of logging a second payment, then says so, with Undo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import FinancialDashboard from "./FinancialDashboard";
import { computeDashboard } from "../lib/computeDashboard";
import { loggedEntries, linkLoggedEntry } from "../lib/alreadyLogged";
import { asCalendarDay } from "../lib/calendarDay";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
vi.mock("../lib/auth", () => ({ getSession: () => null, getRecoveryTokenForSync: vi.fn(async () => null) }));
beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0), toFake: ["Date"] }); }); // 13 November 2026
afterEach(() => { cleanup(); vi.useRealTimers(); });

// Internet is due on 15 November (in 2 days: in the chips); it was logged by hand on the 12th.
const INTERNET = { id: "r-net", name: "Internet", emoji: "I", amount: 30, currency: "USD", bucket: "NEEDS", frequency: "monthly",
  startDate: "2026-11-15", confirmCutoverDate: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z" } as StoredRecurring;
const HAND: StoredTransaction = { id: "hand-net", amount: 30, currency: "USD", bucket: "NEEDS", description: "internet ", date: "2026-11-12",
  paymentMethod: "card", createdAt: "2026-11-12T09:00:00.000Z" };
const data = (transactions: StoredTransaction[]) => ({ ...DEFAULT_DATA, income: 3000, recurring: [INTERNET], transactions }) as LocalFinancials;

function show(d: LocalFinancials, withFound = true) {
  const dash = computeDashboard(d);
  const props = {
    onConfirmRecurring: vi.fn(),
    onLink: vi.fn(async () => true),
    onUnlink: vi.fn(async () => true),
  };
  const found = withFound ? loggedEntries(d, dash.upcomingRenewals) : {};
  const view = render(<FinancialDashboard data={dash} financials={d} found={found} {...props} />);
  const list = () => screen.getByText("Renewing soon").parentElement as HTMLElement;
  return { ...props, dash, view, list };
}

describe("Renewing soon: Already logged on a chip whose cycle was logged by hand", () => {
  it("premise: the rule finds the entry for Internet's cycle due on 15 November", () => {
    const d = data([HAND]);
    expect(loggedEntries(d, computeDashboard(d).upcomingRenewals)).toEqual({ "r-net": { txId: "hand-net", description: "internet", date: "2026-11-12", amount: 30, currency: "USD" } });
  });

  it("names the entry; Already logged leads (filled), Confirm is outlined, and the button is described by its line", () => {
    const { list } = show(data([HAND]));
    const line = within(list()).getByText("You logged internet on 12/11/2026 ($30.00).");
    const already = within(list()).getByRole("button", { name: "Already logged" });
    expect(already.getAttribute("aria-describedby")).toBe(line.id);
    expect(line.id).not.toBe("");
    const confirm = within(list()).getByTitle("Confirm this Internet payment");
    expect(already.style.background).not.toBe("");
    expect(confirm.style.background).toBe("");
    expect(confirm.style.border).not.toBe("");
    // Already logged comes first.
    expect(already.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Already logged links the entry to the cycle, then says so with Undo; Undo takes the link off", async () => {
    const { list, onLink, onUnlink, onConfirmRecurring } = show(data([HAND]));
    fireEvent.click(within(list()).getByRole("button", { name: "Already logged" }));
    expect(onLink).toHaveBeenCalledWith("r-net", "hand-net", "2026-11-15");
    expect(onConfirmRecurring).not.toHaveBeenCalled();
    await waitFor(() => expect(within(list()).getByRole("status").textContent).toBe("Internet: your entry of 12/11/2026 now counts as this payment. Nothing new was logged."));
    fireEvent.click(within(list()).getByRole("button", { name: "Undo" }));
    expect(onUnlink).toHaveBeenCalledWith("r-net", "hand-net", "2026-11-15");
    await waitFor(() => expect(within(list()).queryByRole("button", { name: "Undo" })).toBeNull());
    expect(within(list()).queryByText(/now counts as this payment/)).toBeNull();
  });

  it("the notice stays when the linked item leaves the list (its next payment is a month away)", async () => {
    const d = data([HAND]);
    const { list, view, onConfirmRecurring, onLink, onUnlink } = show(d);
    fireEvent.click(within(list()).getByRole("button", { name: "Already logged" }));
    await waitFor(() => expect(within(list()).getByRole("status").textContent).toMatch(/now counts as this payment/));
    const linked = linkLoggedEntry(d, "r-net", "hand-net", "2026-11-15", asCalendarDay("2026-11-13"))!;
    const dash = computeDashboard(linked);
    expect(dash.upcomingRenewals.find((r) => r.id === "r-net")).toBeUndefined(); // premise
    view.rerender(<FinancialDashboard data={dash} financials={linked} found={loggedEntries(linked, dash.upcomingRenewals)} onConfirmRecurring={onConfirmRecurring} onLink={onLink} onUnlink={onUnlink} />);
    expect(screen.getByText("Internet: your entry of 12/11/2026 now counts as this payment. Nothing new was logged.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("Confirm clears the notice (the next answer)", async () => {
    const { list, onConfirmRecurring } = show(data([HAND]));
    fireEvent.click(within(list()).getByRole("button", { name: "Already logged" }));
    await waitFor(() => expect(within(list()).getByRole("status").textContent).toMatch(/now counts/));
    fireEvent.click(within(list()).getByTitle("Confirm this Internet payment"));
    expect(onConfirmRecurring).toHaveBeenCalledWith("r-net");
    await waitFor(() => expect(within(list()).queryByText(/now counts as this payment/)).toBeNull());
  });

  it("nothing logged by hand: no line, no Already logged, and Confirm as before (filled)", () => {
    const { list } = show(data([]));
    expect(within(list()).queryByText(/You logged/)).toBeNull();
    expect(within(list()).queryByRole("button", { name: "Already logged" })).toBeNull();
    expect(within(list()).getByTitle("Confirm this Internet payment").style.background).not.toBe("");
  });

  it("without a link handler (no wiring), no Already logged even when an entry is found", () => {
    const d = data([HAND]);
    const dash = computeDashboard(d);
    render(<FinancialDashboard data={dash} financials={d} found={loggedEntries(d, dash.upcomingRenewals)} onConfirmRecurring={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Already logged" })).toBeNull();
  });
});
