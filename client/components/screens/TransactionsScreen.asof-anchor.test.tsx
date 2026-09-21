// 2.4.93, the last two sites: an as-of date built as the 1st of the month
// from a CYCLE key.
//
//   new Date(`${ym}-01T00:00:00`)
//
// A cycle key's "01" is not the cycle's first day at any payday past the
// 1st. Cycle 2026-07 at startDay 27 runs 27 Jul - 26 Aug; the 1st of July
// is 26 days BEFORE it starts and belongs to the previous cycle entirely.
// Every recurring item is therefore evaluated for activity on a date
// outside the cycle being asked about.
//
// THE DEFECT IS BIDIRECTIONAL, which is why both directions are tested:
//
//   * an item that STARTS mid-cycle reads inactive on the 1st -> undercount
//   * an item that ENDED before the payday reads active on the 1st  -> overcount
//
// The undercount alone would be consistent with "the anchor is merely
// early." The overcount is what shows the anchor is in a different cycle,
// and it is the direction reasoning misses -- same lesson as 2.4.100's
// inverted assertion exposing the 0x08 bytes.
//
// Two sites, both in this file, both fixed together:
//   :65  recurringForMonth   -> bucket-summary cards + category trends
//   :237 categoryBreakdown   -> the "By category" donut
//
// The two already-fixed siblings in this same file (:139 recurActiveMonths,
// :195 recurringRowsForMonth) use `cycleBounds(mo, startDay).start`. That is
// the convention these two join -- not computeDashboard's historizedRecurAsOf,
// which answers a different question (it falls back to the cycle's LAST day
// for an item inactive at the start, because a trend bar must not drop an
// item that ran for part of the period). This screen's own doc comment says
// "as of its first day ... all that matters is whether the item was active
// then at all", and the two fixed siblings already implement exactly that.
//
// WHICH INPUTS THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * startDay 1 -- inert by construction: cycleBounds("2026-07", 1).start
//     IS 1 July, so the old and new expressions are the same Date. Tested
//     as a control rather than skipped, because "inert at 1" is the claim.
//   * the CURRENT cycle -- both branches pass `new Date()` and never reach
//     the anchor at all. Also tested, as the premise that the ternary's
//     other arm is what these tests are moving.
//   * the "all time" filter -- recurForFilter hardcodes zero there and the
//     category breakdown skips recurring entirely. Out of reach on purpose.
//   * Category trends (:292) consume recurringForMonth too, over all 24
//     walked cycles. Not asserted here: the trend rows aggregate several
//     cycles into one figure, so a single cycle's correction is not
//     separable in the rendered output. Named rather than silently skipped.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import TransactionsScreen from "./TransactionsScreen";
import {
  DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction,
} from "../../lib/localData";

afterEach(() => { cleanup(); });

// Fixed "today" so cycle identity is not a function of when the suite runs.
// 2026-09-21 at startDay 27 is cycle 2026-08 (21 Sep is before the 27th, so
// it belongs to the cycle that opened 27 Aug) and at startDay 1 is 2026-09.
// Either way the cycle under test, 2026-07, is a PAST one.
const TODAY = new Date(2026, 8, 21, 12, 0, 0);

function withFixedNow<T>(fn: () => T): T {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
  try { return fn(); } finally { vi.useRealTimers(); }
}

const RECUR = (over: Partial<StoredRecurring>): StoredRecurring => ({
  id: "r1", name: "Tuition", emoji: "U", amount: 600, currency: "USD",
  frequency: "monthly", bucket: "NEEDS", category: "education",
  startDate: "2026-01-01", endDate: null, totalAmount: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  // Keeps historizedRecurringContribution on its GRANDFATHERED branch for
  // cycle 2026-07, which is the branch that consults `asOf` at all. At
  // startDay 27, 2026-09-30 resolves to cycle 2026-09; at startDay 1 to
  // 2026-09. "2026-07" is below both, so the branch is stable across the
  // one variable these tests change.
  confirmCutoverDate: "2026-09-30",
  ...over,
});

const TX = (id: string, date: string): StoredTransaction => ({
  id, amount: 10, currency: "USD", bucket: "WANTS", description: "anchor tx", date,
});

function renderScreen(over: Partial<LocalFinancials>) {
  const data = {
    ...DEFAULT_DATA, income: 3000,
    // One transaction in July and one in early August, so cycle 2026-07 is
    // an option in the month picker at BOTH start days -- at 27 the August
    // one falls in cycle 2026-07 (27 Jul - 26 Aug), at 1 the July one does.
    transactions: [TX("t1", "2026-07-20"), TX("t2", "2026-08-01")],
    ...over,
  } as LocalFinancials;
  render(<TransactionsScreen financials={data} onChange={vi.fn()} onEdit={vi.fn()} />);
}

/**
 * The "Where it went" donut legend, scoped.
 *
 * Scoping matters and was found by perturbation, not by reading: the
 * Category trends section further down the page renders the same category
 * names and figures, and it is fed by recurringForMonth (:65). An unscoped
 * query therefore passed while :237 was still broken -- the assertion was
 * reading the OTHER site's output. Exactly 2.4.97's vacuous-premise family.
 */
function legend(): HTMLElement {
  const heading = screen.getByText(/Where it went/);
  const el = heading.parentElement;
  if (!el) throw new Error("legend container not found");
  return el;
}

/** Pick a cycle in the month <select>. */
function selectCycle(key: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: key } });
}

/**
 * The bucket cards' "incl. $X recurring" line, or "" if absent.
 *
 * Not scoped to the Needs card by walking up from its label: "Needs"
 * appears three times on this screen (card label, donut legend, trend
 * legend) and a parentElement walk picks whichever the query happened to
 * match first. Every fixture here has exactly one recurring item and it is
 * NEEDS, so the line is unique on the page -- asserted, not assumed.
 */
function needsRecurringLine(): string {
  const all = screen.queryAllByText(/incl\. .* recurring/);
  expect(all.length).toBeLessThanOrEqual(1);
  return all.length ? (all[0].textContent ?? "") : "";
}

// ───────────────── 1. undercount: an item that starts mid-cycle ─────────────────

describe("1. UNDERCOUNT — an item starting inside the cycle reads inactive on the 1st", () => {
  it("startDay 27: a 15 Jul start contributes to cycle 27 Jul - 26 Aug", () => {
    withFixedNow(() => {
      renderScreen({ cycleStartDay: 27, recurring: [RECUR({ startDate: "2026-07-15" })] });
      selectCycle("2026-07");
      // The cycle opens 27 July. An item live since 15 July is active for
      // every single day of it. Anchored on 1 July it reads "not started".
      expect(needsRecurringLine()).toMatch(/\$600/);
    });
  });

  it("startDay 1: the same fixture is genuinely zero — the anchor is correct there", () => {
    withFixedNow(() => {
      renderScreen({ cycleStartDay: 1, recurring: [RECUR({ startDate: "2026-07-15" })] });
      selectCycle("2026-07");
      // Cycle 2026-07 at startDay 1 IS the calendar month, and its own first
      // day is 1 July, when the item had not started. Zero is right here.
      // Same fixture, opposite expectation, and the only variable is payday.
      expect(needsRecurringLine()).toBe("");
    });
  });
});

// ───────────────── 2. overcount: an item that ended before the payday ─────────────────

describe("2. OVERCOUNT — an item that ended before the payday reads active on the 1st", () => {
  it("startDay 27: a 10 Jul end contributes NOTHING to cycle 27 Jul - 26 Aug", () => {
    withFixedNow(() => {
      renderScreen({ cycleStartDay: 27, recurring: [RECUR({ endDate: "2026-07-10" })] });
      selectCycle("2026-07");
      // The item was over 17 days before this cycle opened. Anchored on
      // 1 July it is still running, so the cycle is charged $600 for a bill
      // that no longer existed. This is the direction that proves the
      // anchor is in a DIFFERENT cycle, not merely a few days early.
      expect(needsRecurringLine()).toBe("");
    });
  });

  it("startDay 1: the same fixture DOES contribute — it ran for part of that month", () => {
    withFixedNow(() => {
      renderScreen({ cycleStartDay: 1, recurring: [RECUR({ endDate: "2026-07-10" })] });
      selectCycle("2026-07");
      expect(needsRecurringLine()).toMatch(/\$600/);
    });
  });
});

// ───────────────── 3. the second site: the category donut ─────────────────

describe("3. the \"By category\" donut reads the same anchor (:237)", () => {
  it("startDay 27: the mid-cycle item appears under its category", () => {
    withFixedNow(() => {
      renderScreen({ cycleStartDay: 27, recurring: [RECUR({ startDate: "2026-07-15" })] });
      selectCycle("2026-07");
      fireEvent.click(screen.getByRole("button", { name: "By category" }));
      // Premise: the donut is rendering at all for this filter, so an
      // absent Education row below is a missing contribution rather than a
      // missing section.
      expect(screen.getByRole("button", { name: "By type" })).toBeTruthy();
      // Regex, not the exact string: the legend row renders the icon and
      // the label as sibling text nodes in one span ("EMOJI Education"), so
      // an exact-string query never matches however the fix behaves.
      expect(within(legend()).queryAllByText(/Education/).length).toBeGreaterThan(0);
      // And the figure, not just the label: $600 from the recurring item,
      // in the legend row beside its label.
      expect(within(legend()).getAllByText(/\$600/).length).toBeGreaterThan(0);
    });
  });

  it("startDay 27: the ended item does NOT appear under its category", () => {
    withFixedNow(() => {
      renderScreen({ cycleStartDay: 27, recurring: [RECUR({ endDate: "2026-07-10" })] });
      selectCycle("2026-07");
      fireEvent.click(screen.getByRole("button", { name: "By category" }));
      expect(screen.getByRole("button", { name: "By type" })).toBeTruthy();
      expect(within(legend()).queryAllByText(/Education/).length).toBe(0);
      // Premise: the legend is populated at all, by the one in-cycle
      // transaction -- so an absent Education row is an exclusion rather
      // than an empty section. Matched loosely: RTL's getNodeText reads only DIRECT text-node
      // children, so this row's node yields "$10 " -- the "· 100%" sits in a
      // nested span and is unreachable by a whole-row matcher:
      // writing one here produced a literal 0x08 byte (2.4.100's exact
      // defect, recurring) and the failing assertion PRINTED it invisibly.
      expect(within(legend()).getAllByText(/\$10/).length).toBeGreaterThan(0);
    });
  });
});

// ───────────────── 4. controls ─────────────────

describe("4. controls — what these tests must NOT be moving", () => {
  it("the CURRENT cycle is evaluated as of now, not as of any anchor", () => {
    withFixedNow(() => {
      // Current cycle at startDay 27 is 2026-08 (27 Aug - 26 Sep). An item
      // running since January is active today; both the old and the new
      // expression take the `new Date()` arm and never touch the anchor.
      // Pins that arm so a fix to the other one cannot quietly change it.
      renderScreen({ cycleStartDay: 27, recurring: [RECUR({})] });
      selectCycle("2026-08");
      expect(needsRecurringLine()).toMatch(/\$600/);
    });
  });

  it("an always-active item is unaffected at either payday — the fix is inert for it", () => {
    withFixedNow(() => {
      renderScreen({ cycleStartDay: 27, recurring: [RECUR({})] });
      selectCycle("2026-07");
      expect(needsRecurringLine()).toMatch(/\$600/);
    });
    cleanup();
    withFixedNow(() => {
      renderScreen({ cycleStartDay: 1, recurring: [RECUR({})] });
      selectCycle("2026-07");
      expect(needsRecurringLine()).toMatch(/\$600/);
    });
  });
});
