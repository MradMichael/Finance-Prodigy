// TODO 124 (owner, session 64, item 3): the reminder's "Already logged" choice in the entry form's recurring rows,
// with the sentences approved for the reminder. A row's Confirm opens its "Confirm payment" form; when an entry logged
// by hand matches the cycle it would settle (the row's own target, lib/alreadyLogged.ts's rule), the form names it,
// "Already logged" leads (filled) and the form's Confirm is outlined. The harness is InputPanel.extra-payment.test.tsx's.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../lib/localData";

const NOW = new Date(2026, 8, 21); // 21 September 2026
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

// Uni was due on 15 September and isn't confirmed; it was logged by hand on the 14th.
const UNI: StoredRecurring = { id: "r1", name: "Uni", emoji: "U", amount: 750, currency: "USD", frequency: "monthly", bucket: "NEEDS",
  startDate: "2026-09-15", endDate: null, totalAmount: null, createdAt: "2026-01-15T00:00:00.000Z" };
const HAND: StoredTransaction = { id: "hand-uni", amount: 750, currency: "USD", bucket: "NEEDS", description: "Uni", date: "2026-09-14",
  paymentMethod: "card", createdAt: "2026-09-14T09:00:00.000Z" };

function renderPanel(transactions: StoredTransaction[], wired = true) {
  const data = { ...DEFAULT_DATA, income: 3000, recurring: [UNI], transactions } as LocalFinancials;
  const p = { onConfirmRecurring: vi.fn(), onLinkLogged: vi.fn(async () => true), onUnlinkLogged: vi.fn(async () => true) };
  render(<InputPanel financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()}
    onConfirmRecurring={p.onConfirmRecurring} {...(wired ? { onLinkLogged: p.onLinkLogged, onUnlinkLogged: p.onUnlinkLogged } : {})} />);
  return p;
}
async function openConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Manage/ }));
  await user.click(screen.getByRole("button", { name: /Recurring Payments/ }));
  await user.click(screen.getByRole("button", { name: "Confirm this Uni payment" }));
  return screen.getByText("Confirm payment").parentElement as HTMLElement;
}

describe("the entry form: Already logged in a row's Confirm payment form", () => {
  it("names the entry; Already logged leads (filled), the form's Confirm is outlined", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel([HAND]);
    const form = await openConfirm(user);
    const line = within(form).getByText("You logged Uni on 14/09/2026 ($750.00).");
    const already = within(form).getByRole("button", { name: "Already logged" });
    expect(already.getAttribute("aria-describedby")).toBe(line.id);
    const confirm = within(form).getByRole("button", { name: "Confirm" });
    expect(already.style.background).not.toBe("");
    expect(confirm.style.background).toBe("");
    expect(already.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Already logged links the entry to the row's cycle (not today's), closes the form, then says so with Undo", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const p = renderPanel([HAND]);
    const form = await openConfirm(user);
    await user.click(within(form).getByRole("button", { name: "Already logged" }));
    expect(p.onLinkLogged).toHaveBeenCalledWith("r1", "hand-uni", "2026-09-15");
    expect(p.onConfirmRecurring).not.toHaveBeenCalled();
    const notice = await screen.findByText("Uni: your entry of 14/09/2026 now counts as this payment. Nothing new was logged.");
    expect(notice.getAttribute("role")).toBe("status");
    expect(screen.queryByText("Confirm payment")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(p.onUnlinkLogged).toHaveBeenCalledWith("r1", "hand-uni", "2026-09-15");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
  });

  it("nothing logged by hand: the form as before (no line, no Already logged, Confirm filled)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel([]);
    const form = await openConfirm(user);
    expect(within(form).queryByText(/You logged/)).toBeNull();
    expect(within(form).queryByRole("button", { name: "Already logged" })).toBeNull();
    expect(within(form).getByRole("button", { name: "Confirm" }).style.background).not.toBe("");
  });

  it("without a link handler, no Already logged even when an entry matches", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPanel([HAND], false);
    const form = await openConfirm(user);
    expect(within(form).queryByRole("button", { name: "Already logged" })).toBeNull();
  });
});
