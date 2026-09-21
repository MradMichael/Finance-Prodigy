// 2.4.126, the two sites that only exist in the component: the stamp and
// the delete strip. Every CONSEQUENCE of the field choice is pure and lives
// in lib/extra-payment-key.test.ts; what is here is the wiring, driven
// through the real UI because logExtraPayment builds its transaction inline
// rather than through an extracted builder.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import {
  DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction,
} from "../lib/localData";

const NOW = new Date(2026, 8, 21);
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

const REC: StoredRecurring = {
  id: "r1", name: "Uni", emoji: "U", amount: 750, currency: "USD",
  frequency: "monthly", bucket: "NEEDS",
  startDate: "2026-01-15", endDate: null, totalAmount: null,
  createdAt: "2026-01-15T00:00:00.000Z",
};

function renderPanel(over: Partial<LocalFinancials> = {}) {
  const data: LocalFinancials = {
    ...DEFAULT_DATA, income: 3000, recurring: [REC], ...over,
  } as LocalFinancials;
  let latest: LocalFinancials = data;
  const onChange = vi.fn((u: LocalFinancials) => { latest = u; });
  render(
    <InputPanel
      financials={data}
      dashData={computeDashboard(data)}
      onChange={onChange}
      onEdit={vi.fn()}
      onPay={vi.fn()}
    />,
  );
  return { onChange, getLatest: () => latest };
}

/**
 * The Recurring list is two clicks deep: the "Manage" tab (activeTab state,
 * default "daily"), then the collapsed "Recurring Payments" section inside
 * it. Both matched by regex -- the accessible names carry an icon, a count
 * badge and a disclosure caret alongside the label.
 */
async function openRecurringSection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Manage/ }));
  await user.click(screen.getByRole("button", { name: /Recurring Payments/ }));
}

describe("the +extra payment carries a key, not just a sentence", () => {
  it("stamps extraForRecurringId and leaves recurringId alone", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { getLatest } = renderPanel();
    await openRecurringSection(user);

    await user.click(screen.getByRole("button", { name: "Log an extra payment" }));
    fireEvent.change(screen.getByPlaceholderText("Extra amount"), { target: { value: "200" } });
    await user.click(screen.getByRole("button", { name: "Log" }));

    const tx = getLatest().transactions[0];
    // Premise: the right transaction was created at all, so the field
    // assertions below are not being read off an unrelated row.
    expect(tx.amount).toBe(200);
    expect(tx.description).toBe("Extra: Uni");

    expect(tx.extraForRecurringId).toBe("r1");
    // The whole point of the separate field: every existing reader keys on
    // recurringId, and none of them may see this row.
    expect(tx.recurringId).toBeUndefined();
    expect(tx.cycleDate).toBeUndefined();
  });
});

describe("deleting the recurring item clears the link — 2.4.35's rule", () => {
  const extra: StoredTransaction = {
    id: "x1", amount: 200, currency: "USD", bucket: "NEEDS",
    description: "Extra: Uni", date: "2026-09-15", extraForRecurringId: "r1",
  };
  const confirmedTx: StoredTransaction = {
    id: "c1", amount: 750, currency: "USD", bucket: "NEEDS",
    description: "Uni", date: "2026-09-15", cycleDate: "2026-09-15", recurringId: "r1",
  };
  const unrelated: StoredTransaction = {
    id: "u1", amount: 40, currency: "USD", bucket: "WANTS",
    description: "Coffee", date: "2026-09-15",
  };

  it("strips extraForRecurringId, and keeps stripping recurringId/cycleDate", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { getLatest } = renderPanel({ transactions: [extra, confirmedTx, unrelated] });
    await openRecurringSection(user);

    await user.click(screen.getByRole("button", { name: "Delete recurring payment" }));
    const after = getLatest();

    // Premise: the item really was deleted, so the field changes below are
    // the delete handler running rather than a no-op render.
    expect(after.recurring).toHaveLength(0);

    const x = after.transactions.find((t) => t.id === "x1")!;
    expect(x.extraForRecurringId).toBeUndefined();
    // An extra payment never settled a cycle, so it gets no detach sentinel
    // -- undefined is the whole of its cleared state.
    expect(x.cycleDate).toBeUndefined();

    // The confirmation's existing behaviour is unchanged.
    const c = after.transactions.find((t) => t.id === "c1")!;
    expect(c.recurringId).toBeUndefined();
    expect(c.cycleDate).toBeNull();

    // And a transaction that was never linked is not rewritten at all --
    // otherwise the map would be stamping updatedAt across the whole ledger.
    const u = after.transactions.find((t) => t.id === "u1")!;
    expect(u).toBe(unrelated);
  });
});
