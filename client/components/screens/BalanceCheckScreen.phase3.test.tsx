// Period close Phase 3 — the UI half: the unclosed list, and closing a past
// cycle from it.
//
// The pure half (expected-as-of, the span rule, the window, the backwards
// predicate) is in lib/period-close.phase3.test.ts. What is here is what only
// the component can answer: that the list is quiet, that closing from a row
// closes THAT cycle rather than the current one, that a late close reaches
// the as-of figure, and that a backwards close records without reanchoring.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * the nav, Overview, and the alert list. "Quiet" is partly a claim about
//     surfaces this component cannot see. Asserted here only as "no count and
//     no badge ON THIS SCREEN"; the absence of an Overview chip is a fact
//     about computeDashboard's alerts, which Phase 2's own tests cover and
//     which nothing in Phase 3 adds to.
//   * the 12-cycle cap. Reachable in the pure tests; driving 13 cycles
//     through the component would assert the same slice twice.
//   * an account with no startingAt inside a BACKWARDS close. The predicate
//     says such a row is reanchorable, so it cannot be recorded-only --
//     covered in the pure file, unreachable from here by construction.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import {
  DEFAULT_DATA,
  type LocalFinancials, type TrackedBalance, type StoredTransaction, type PeriodClose,
} from "../../lib/localData";
import { asCycleKey, cycleBounds, cycleCloseInstant, currentCycleKey } from "../../lib/period";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const START_DAY = 27;
// 5 Nov 2026 -> current cycle 2026-10 (27 Oct - 26 Nov). 2026-09 and 2026-08
// are both safely in the past, which is what makes a "late close" reachable.
const NOW = new Date(2026, 10, 5, 12, 0, 0);
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const TB = (over: Partial<TrackedBalance> = {}): TrackedBalance => ({
  id: "tb1", name: "Cash", paymentMethod: "cash",
  startingBalance: 500, startingDate: "2026-08-01", startingAt: "2026-08-01T09:00:00.000Z",
  currency: "USD", ...over,
});
const TX = (id: string, date: string, amount = 10): StoredTransaction => ({
  id, amount, currency: "USD", bucket: "NEEDS", description: "x", date, paymentMethod: "cash",
});
const closeOf = (key: string, startDay: number): PeriodClose => {
  const b = cycleBounds(asCycleKey(key), startDay);
  return {
    cycleKey: asCycleKey(key),
    rangeStart: localISO(b.start), rangeEnd: localISO(new Date(b.end.getTime() - 1)),
    startDayAtClose: startDay, closedAt: "2026-10-27T06:00:00.000Z", accounts: [],
  };
};

function renderScreen(over: Partial<LocalFinancials> = {}) {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const data = {
    ...DEFAULT_DATA, income: 3000, cycleStartDay: START_DAY,
    trackedBalances: [TB()], transactions: [TX("t", "2026-08-01")],
    ...over,
  } as LocalFinancials;
  const onChange = vi.fn();
  render(<BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}
const written = (onChange: ReturnType<typeof vi.fn>): LocalFinancials =>
  onChange.mock.calls[onChange.mock.calls.length - 1][0] as LocalFinancials;

// ───────────────────── 1. the list is quiet ─────────────────────

describe("1. the unclosed-cycle list", () => {
  it("does not appear at all before the first close", () => {
    // The anti-guilt bound. A new account greeted with a backlog abandons
    // the ritual, and then the record is worse than none.
    renderScreen({ periodCloses: [] });
    expect(screen.queryByText("Cycles not closed")).toBeNull();
  });

  it("appears once one cycle is closed, and lists the gaps", () => {
    renderScreen({ periodCloses: [closeOf("2026-09", START_DAY)] });
    expect(screen.getByText("Cycles not closed")).toBeTruthy();
    // 2026-08 is 27 Aug - 26 Sep and was skipped.
    expect(screen.getByRole("button", { name: /Close the cycle 27 Aug/ })).toBeTruthy();
  });

  it("carries no count, no badge, no number anywhere in its heading", () => {
    // "Quiet" as far as this screen can assert it.
    renderScreen({ periodCloses: [closeOf("2026-09", START_DAY)] });
    expect(screen.getByText("Cycles not closed").textContent).toBe("Cycles not closed");
  });

  it("explains a cycle that was closed under a previous payday", () => {
    // The span rule's consequence, surfaced rather than left as a mystery.
    renderScreen({ periodCloses: [closeOf("2026-09", START_DAY), closeOf("2026-08", 1)] });
    expect(screen.getByText(/under your previous payday; that was a different period/)).toBeTruthy();
  });

  it("the closed cycle itself is not listed — the premise for every absence above", () => {
    renderScreen({ periodCloses: [closeOf("2026-09", START_DAY)] });
    expect(screen.queryByRole("button", { name: /Close the cycle 27 Sep/ })).toBeNull();
  });
});

// ───────────────────── 2. closing a past cycle ─────────────────────

const openRow = (label: RegExp) => fireEvent.click(screen.getByRole("button", { name: label }));
const amountFor = (name: string) => screen.getByLabelText(new RegExp(`what ${name} actually holds`, "i"));
const confirmClose = () => fireEvent.click(screen.getByRole("button", { name: /^Close cycle$/ }));

describe("2. closing a named past cycle", () => {
  it("closes THAT cycle, not the current one", () => {
    const { onChange } = renderScreen({ periodCloses: [closeOf("2026-09", START_DAY)] });
    openRow(/Close the cycle 27 Aug/);
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    confirmClose();
    const rec = written(onChange).periodCloses!.find((c) => c.closedAt !== "2026-10-27T06:00:00.000Z")!;
    expect(rec.cycleKey).toBe("2026-08");
    expect(rec.rangeStart).toBe("2026-08-27");
    expect(rec.rangeEnd).toBe("2026-09-26");
    // Premise: the CURRENT cycle is 2026-10, so this really is a past close.
    expect(currentCycleKey(NOW, START_DAY)).toBe("2026-10");
  });

  it("pins the baseline to THAT cycle's end instant", () => {
    const { onChange } = renderScreen({ periodCloses: [closeOf("2026-09", START_DAY)] });
    openRow(/Close the cycle 27 Aug/);
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    confirmClose();
    expect(written(onChange).trackedBalances[0].startingAt)
      .toBe(cycleCloseInstant(asCycleKey("2026-08"), START_DAY));
  });

  it("records lateness: closedAt is well after rangeEnd", () => {
    const { onChange } = renderScreen({ periodCloses: [closeOf("2026-09", START_DAY)] });
    openRow(/Close the cycle 27 Aug/);
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    confirmClose();
    const rec = written(onChange).periodCloses!.find((c) => c.cycleKey === "2026-08")!;
    expect(rec.closedAt > rec.rangeEnd).toBe(true);
    expect(new Date(rec.closedAt).getTime()).toBe(NOW.getTime());
  });

  it("tells the user how late, and against which date the figures are judged", () => {
    renderScreen({ periodCloses: [closeOf("2026-09", START_DAY)] });
    openRow(/Close the cycle 27 Aug/);
    expect(screen.getByText(/after it ended/)).toBeTruthy();
    expect(screen.getByText(/not today/)).toBeTruthy();
  });

  it("uses expected AS OF the cycle end, not the live figure", () => {
    // The whole reason Phase 3 needed new logic. A transaction dated after
    // the cycle end must not move the figure this close is judged against.
    const { onChange } = renderScreen({
      periodCloses: [closeOf("2026-09", START_DAY)],
      transactions: [TX("in", "2026-09-20", 10), TX("after", "2026-10-15", 25)],
    });
    openRow(/Close the cycle 27 Aug/);
    fireEvent.change(amountFor("Cash"), { target: { value: "490" } });
    confirmClose();
    const acc = written(onChange).periodCloses!.find((c) => c.cycleKey === "2026-08")!.accounts[0];
    // 500 - 10 (inside) = 490. The live figure would be 465, and the stated
    // 490 would read as a +25 gap that does not exist.
    expect(acc.expectedAtClose).toBe(490);
    expect(acc.discrepancy).toBe(0);
  });

  it("skipping a cycle then closing a later one leaves the skipped one listed", () => {
    // Gaps stay gaps. Closing September does not backfill August.
    const { onChange } = renderScreen({ periodCloses: [closeOf("2026-09", START_DAY)] });
    openRow(/Close the cycle 27 Jul/);
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    confirmClose();
    const keys = written(onChange).periodCloses!.map((c) => c.cycleKey);
    expect(keys).toContain("2026-07");
    expect(keys).not.toContain("2026-08");
  });
});

// ───────── 3. a close never moves a baseline backwards ─────────

describe("3. backwards close records without reanchoring", () => {
  // Baseline already at 20 Oct, later than 2026-08's end (26 Sep).
  const NEWER = TB({ startingAt: "2026-10-20T09:00:00.000Z", startingDate: "2026-10-20" });

  it("leaves the TrackedBalance untouched", () => {
    const { onChange, data } = renderScreen({
      trackedBalances: [NEWER], periodCloses: [closeOf("2026-09", START_DAY)],
    });
    openRow(/Close the cycle 27 Aug/);
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    confirmClose();
    const out = written(onChange);
    expect(out.trackedBalances[0].startingAt).toBe("2026-10-20T09:00:00.000Z");
    expect(out.trackedBalances[0].startingBalance).toBe(data.trackedBalances[0].startingBalance);
  });

  it("but still records the account in the close", () => {
    // Recorded, not skipped: the close still states what that cycle ended at.
    const { onChange } = renderScreen({
      trackedBalances: [NEWER], periodCloses: [closeOf("2026-09", START_DAY)],
    });
    openRow(/Close the cycle 27 Aug/);
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    confirmClose();
    const rec = written(onChange).periodCloses!.find((c) => c.cycleKey === "2026-08")!;
    expect(rec.accounts).toHaveLength(1);
    expect(rec.accounts[0].actual).toBe(400);
  });

  it("says so in the dialog, and offers no acknowledgement for it", () => {
    renderScreen({ trackedBalances: [NEWER], periodCloses: [closeOf("2026-09", START_DAY)] });
    openRow(/Close the cycle 27 Aug/);
    fireEvent.change(amountFor("Cash"), { target: { value: "1" } }); // a large gap, if one were computed
    expect(screen.getByText(/will not move it backwards/)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /mark this gap as accounted for/i })).toBeNull();
  });

  it("an account whose baseline is INSIDE the cycle is reanchored normally — the control", () => {
    // Without this, "recorded only" and "the close does nothing" are
    // indistinguishable.
    const { onChange } = renderScreen({ periodCloses: [closeOf("2026-09", START_DAY)] });
    openRow(/Close the cycle 27 Aug/);
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    confirmClose();
    expect(written(onChange).trackedBalances[0].startingBalance).toBe(400);
  });
});

// ───────────────────── 4. re-close refused ─────────────────────

describe("4. re-closing an already-closed cycle", () => {
  it("is not offered — a closed cycle has no row", () => {
    renderScreen({ periodCloses: [closeOf("2026-09", START_DAY), closeOf("2026-08", START_DAY)] });
    expect(screen.queryByRole("button", { name: /Close the cycle 27 Aug/ })).toBeNull();
  });

  it("and the current-cycle button refuses once that cycle is closed", () => {
    // The guard in commitClose, reached through the one path that can still
    // present a closed cycle: the always-present "Close this cycle" button.
    const { onChange } = renderScreen({ periodCloses: [closeOf("2026-10", START_DAY)] });
    fireEvent.click(screen.getByRole("button", { name: /close this cycle/i }));
    fireEvent.change(amountFor("Cash"), { target: { value: "400" } });
    confirmClose();
    expect(onChange).not.toHaveBeenCalled();
  });
});
