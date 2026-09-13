// The 2.4.31 pre-migration backfill, end to end through EditRecurringSheet.
//
// Why this exists: `onBackfillRecurring` and `backfillingIds` are also
// declared on InputPanel, where nothing has consumed them since commit
// e965700 (2026-08-29) extracted the backfill sub-panel out of it. Those two
// dead props are being deleted. The risk in deleting a prop that appears in
// two components is taking the LIVE one by mistake -- `backfillingIds` in
// particular is passed at two call sites in page.tsx, only one of which is
// dead.
//
// So this pins the surviving path: pendingBackfillCycles -> the sub-panel ->
// the callback, with the in-flight disabled state. If the deletion ever
// reaches EditRecurringSheet or its page.tsx wiring, this fails.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import EditRecurringSheet from "./EditRecurringSheet";
import { pendingBackfillCycles, DEFAULT_DATA, type LocalFinancials, type StoredRecurring } from "../lib/localData";

const NOW = new Date(2026, 8, 13); // 13 September 2026
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

/**
 * A recurring item with real pre-cutover history: monthly from June, cutover
 * in September, so June/July/August predate confirmation and are available to
 * backfill. Nothing is confirmed yet.
 *
 * `totalAmount` is REQUIRED, not incidental: pendingBackfillCycles gates on
 * `!r.confirmCutoverDate || !r.totalAmount` and returns [] without it. The
 * first draft of this fixture omitted it and the premise test below caught
 * that the whole file would otherwise have passed vacuously against an empty
 * panel.
 */
const UNI: StoredRecurring = {
  id: "uni", name: "Uni", emoji: "U", amount: 750, currency: "USD",
  frequency: "monthly", bucket: "NEEDS", startDate: "2026-06-01",
  endDate: null, totalAmount: 6750, confirmCutoverDate: "2026-09-01",
  createdAt: "2026-06-01T00:00:00.000Z",
} as StoredRecurring;

function makeData(): LocalFinancials {
  return { ...DEFAULT_DATA, income: 3000, recurring: [UNI], transactions: [] } as LocalFinancials;
}

describe("2.4.31 backfill still works through EditRecurringSheet", () => {
  it("the fixture really has pending cycles — otherwise everything below is vacuous", () => {
    // Premise test. Without this, a panel that renders nothing would satisfy
    // the assertions further down by being empty rather than by working.
    const pending = pendingBackfillCycles(UNI, []);
    expect(pending.length).toBeGreaterThan(0);
  });

  it("renders the pre-migration panel and calls back with the item id and that cycle's own date", () => {
    const data = makeData();
    const onBackfillRecurring = vi.fn();
    render(
      <EditRecurringSheet
        recurring={UNI} financials={data} onChange={vi.fn()} onClose={vi.fn()}
        onBackfillRecurring={onBackfillRecurring} backfillingIds={new Set()}
      />,
    );

    expect(screen.getByText(/Pre-migration cycles/i)).toBeTruthy();
    const confirms = screen.getAllByRole("button", { name: "Confirm" });
    expect(confirms.length).toBe(pendingBackfillCycles(UNI, []).length);

    fireEvent.click(confirms[0]);
    expect(onBackfillRecurring).toHaveBeenCalledTimes(1);
    const [id, dueDate] = onBackfillRecurring.mock.calls[0];
    expect(id).toBe("uni");
    // The cycle's OWN historical due date, not today -- that dating is the
    // whole point of backfill (2.4.31), so it is asserted rather than assumed.
    expect(dueDate).toBeInstanceOf(Date);
    expect((dueDate as Date).toISOString().slice(0, 10)).toBe(
      pendingBackfillCycles(UNI, [])[0].toISOString().slice(0, 10),
    );
    expect((dueDate as Date).getTime()).toBeLessThan(NOW.getTime());
  });

  it("disables the row whose write is in flight, keyed by `${id}:${dueISO}`", () => {
    const data = makeData();
    const first = pendingBackfillCycles(UNI, [])[0].toISOString().slice(0, 10);
    render(
      <EditRecurringSheet
        recurring={UNI} financials={data} onChange={vi.fn()} onClose={vi.fn()}
        onBackfillRecurring={vi.fn()} backfillingIds={new Set([`uni:${first}`])}
      />,
    );
    expect(screen.getByRole("button", { name: /Confirming/i })).toBeTruthy();
    // Only that row: the other pending cycles stay actionable, which is why
    // the key carries the date and not just the recurring id.
    expect(screen.getAllByRole("button", { name: "Confirm" }).length)
      .toBe(pendingBackfillCycles(UNI, []).length - 1);
  });

  it("hides the panel entirely when no handler is supplied — the optional-prop guard still holds", () => {
    const data = makeData();
    render(
      <EditRecurringSheet
        recurring={UNI} financials={data} onChange={vi.fn()} onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Pre-migration cycles/i)).toBeNull();
  });
});
