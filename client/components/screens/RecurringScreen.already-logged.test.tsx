// TODO 124 (owner, session 64, item 3): the reminder's "Already logged" choice on Recurring's due line, with the
// sentences approved for the reminder. The harness is RecurringScreen.due-confirm.test.tsx's.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import RecurringScreen from "./RecurringScreen";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring } from "../../lib/localData";
import type { computeDashboard } from "../../lib/computeDashboard";
import type { LoggedEntry } from "../../lib/alreadyLogged";

afterEach(cleanup);

type Renewal = ReturnType<typeof computeDashboard>["upcomingRenewals"][number];
const rec = (id: string, name: string): StoredRecurring =>
  ({ id, name, emoji: "•", amount: 40, currency: "USD", frequency: "monthly", bucket: "WANTS", startDate: "2026-01-31", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" }) as StoredRecurring;
const renewal = (id: string, name: string, dueInDays: number): Renewal =>
  ({ id, name, emoji: "•", amount: 40, currency: "USD", dueDate: "2026-10-31", dueInDays, overdueCount: 0 });
const ENTRY: LoggedEntry = { txId: "hand-net", description: "internet", date: "2026-10-29", amount: 40, currency: "USD" };
const DATA = { ...DEFAULT_DATA, recurring: [rec("gym", "Gym"), rec("net", "Internet")] } as LocalFinancials;

function show(renewals: Renewal[], found: Record<string, LoggedEntry>, wired = true) {
  const p = { onConfirm: vi.fn(async () => true), onLink: vi.fn(async () => true), onUnlink: vi.fn(async () => true) };
  const view = render(<RecurringScreen financials={DATA} onEdit={vi.fn()} renewals={renewals} onConfirm={p.onConfirm} found={found}
    {...(wired ? { onLink: p.onLink, onUnlink: p.onUnlink } : {})} />);
  return { ...p, view };
}
const rowOf = (name: string) => screen.getByText(name, { exact: false, selector: "p" }).closest("div.flex.items-center") as HTMLElement;

describe("Recurring: Already logged on a due line whose cycle was logged by hand", () => {
  it("names the entry in that row; Already logged leads (filled), Confirm is outlined; the other row is as before", () => {
    show([renewal("net", "Internet", 2), renewal("gym", "Gym", 3)], { net: ENTRY });
    const row = rowOf("Internet");
    const line = within(row).getByText("You logged internet on 29/10/2026 ($40.00).");
    const already = within(row).getByRole("button", { name: "Already logged" });
    expect(already.getAttribute("aria-describedby")).toBe(line.id);
    const confirm = within(row).getByRole("button", { name: "Confirm" });
    expect(already.style.background).not.toBe("");
    expect(confirm.style.background).toBe("");
    expect(already.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const gym = rowOf("Gym");
    expect(within(gym).queryByRole("button", { name: "Already logged" })).toBeNull();
    expect(within(gym).queryByText(/You logged/)).toBeNull();
    expect(within(gym).getByRole("button", { name: "Confirm" }).style.background).not.toBe("");
  });

  it("Already logged links the entry to the cycle, then says so under the row with Undo; Undo takes the link off", async () => {
    const { onLink, onUnlink, onConfirm } = show([renewal("net", "Internet", 2)], { net: ENTRY });
    fireEvent.click(within(rowOf("Internet")).getByRole("button", { name: "Already logged" }));
    expect(onLink).toHaveBeenCalledWith("net", "hand-net", "2026-10-31");
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(within(rowOf("Internet")).getByRole("status").textContent).toBe("Internet: your entry of 29/10/2026 now counts as this payment. Nothing new was logged."));
    fireEvent.click(within(rowOf("Internet")).getByRole("button", { name: "Undo" }));
    expect(onUnlink).toHaveBeenCalledWith("net", "hand-net", "2026-10-31");
    await waitFor(() => expect(within(rowOf("Internet")).queryByRole("button", { name: "Undo" })).toBeNull());
  });

  it("the notice stays under the row when its due line goes (the cycle now counts)", async () => {
    const { view, onConfirm, onLink, onUnlink } = show([renewal("net", "Internet", 2)], { net: ENTRY });
    fireEvent.click(within(rowOf("Internet")).getByRole("button", { name: "Already logged" }));
    await waitFor(() => expect(within(rowOf("Internet")).getByRole("status").textContent).toMatch(/now counts as this payment/));
    view.rerender(<RecurringScreen financials={DATA} onEdit={vi.fn()} renewals={[]} onConfirm={onConfirm} found={{}} onLink={onLink} onUnlink={onUnlink} />);
    expect(within(rowOf("Internet")).queryByRole("button", { name: "Confirm" })).toBeNull(); // premise: no due line
    expect(within(rowOf("Internet")).getByRole("status").textContent).toMatch(/now counts as this payment/);
    expect(within(rowOf("Internet")).getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("without a link handler, no Already logged even when an entry is found", () => {
    show([renewal("net", "Internet", 2)], { net: ENTRY }, false);
    expect(screen.queryByRole("button", { name: "Already logged" })).toBeNull();
    expect(within(rowOf("Internet")).getByRole("button", { name: "Confirm" }).style.background).not.toBe("");
  });
});
