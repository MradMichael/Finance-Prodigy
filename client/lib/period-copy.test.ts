// Period-claim copy must follow the period noun.
//
// WHY THIS FILE EXISTS. Phase 2b converted the copy it happened to be
// editing for other reasons and left ~30 sibling strings saying "month" --
// including two savings-pacing strings in the SAME block as three that were
// converted, and an alert three lines from the `noun` it should have used
// (2.4.100). Per-site fixing is what produced that, so this asserts the
// class rather than the sites: every user-facing string computeDashboard
// emits is checked for a bare period claim at startDay 27.
//
// Deliberately NOT a grep over source files -- that would re-run the same
// kind of survey that missed them. This reads the actual rendered payload.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";

const NOW = new Date(2026, 9, 10); // 10 Oct 2026 -- day 14 of the 27-Sep cycle
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

const tx = (id: string, date: string, amount: number, bucket: StoredTransaction["bucket"]): StoredTransaction =>
  ({ id, date, amount, currency: "USD", bucket, description: id } as StoredTransaction);

/**
 * Rich enough that the pacing, encouragement, streak and alert strings all
 * actually fire -- an empty fixture would emit almost no copy and the sweep
 * below would pass by having nothing to look at.
 */
/**
 * TWO fixtures, because no single one emits every string type: a streak
 * needs six prior cycles of saving, and those same six cycles create a
 * budget rollover large enough that nothing can read "over budget".
 *
 * The first version of this file used one fixture and asserted only
 * `alerts.length > 0`. That passed -- on an unrelated safety-net alert --
 * while the budget alert never fired at all, so perturbing the budget
 * string back to "month" did NOT go red. The premises below are therefore
 * per-string-type, not per-array.
 */
function overspent(cycleStartDay?: number): LocalFinancials {
  // No history at all, so rollover cannot inflate the targets. Wants target
  // is 30% of 3000 = $900; $2,400 against it reads "over".
  return {
    ...DEFAULT_DATA, income: 3000, budgetRule: "50-30-20",
    ...(cycleStartDay ? { cycleStartDay } : {}),
    transactions: [
      // Dated into EARLY OCTOBER on purpose: 2-4 Oct is inside the
      // 27-Sep cycle AND inside calendar October, so the identical fixture
      // exercises both configurations. Dates in late September satisfied
      // only the cycle, which left the startDay-1 control with almost no
      // copy to check -- caught by that control failing.
      tx("w1", "2026-10-02", 2400, "WANTS"),
      tx("n1", "2026-10-03", 1600, "NEEDS"),
      tx("s1", "2026-10-04", 150, "SAVINGS"),
    ],
  } as LocalFinancials;
}

function streaking(cycleStartDay?: number): LocalFinancials {
  return {
    ...DEFAULT_DATA, income: 3000, budgetRule: "50-30-20",
    ...(cycleStartDay ? { cycleStartDay } : {}),
    transactions: [
      tx("s1", "2026-10-04", 150, "SAVINGS"),
      // SEVEN prior contributions, not six: at startDay 1 the walk starts at
      // September, so a run ending in August leaves the first step back
      // empty and no streak forms at all.
      ...Array.from({ length: 7 }, (_, i) => tx(`p${i}`, `2026-0${i + 3}-28`, 700, "SAVINGS")),
    ],
  } as LocalFinancials;
}

/** Every user-facing string the payload carries, flattened. */
function allCopy(d: ReturnType<typeof computeDashboard>): string[] {
  return [
    ...d.budgetPace.map((p) => p.message),
    ...d.streaks.map((s) => s.message),
    ...d.alerts.map((a) => a.message),
    ...d.encouragements,
    d.periodLabel,
  ].filter(Boolean);
}

const copyAt = (startDay?: number) =>
  [...allCopy(computeDashboard(overspent(startDay))), ...allCopy(computeDashboard(streaking(startDay)))];

describe("computeDashboard's copy follows the period noun", () => {
  it("PREMISE: each string type this sweep relies on actually fires", () => {
    // Named individually. `alerts.length > 0` is not enough -- an unrelated
    // safety-net alert satisfies it while the budget alert stays silent,
    // which is how the first version of this file passed vacuously.
    const over = computeDashboard(overspent(27));
    const strk = computeDashboard(streaking(27));
    expect(over.alerts.some((a) => a.id.startsWith("budget-"))).toBe(true);
    expect(over.budgetPace.some((p) => p.status === "over")).toBe(true);
    expect(strk.streaks.some((s) => s.key === "savings-streak")).toBe(true);
    expect(strk.encouragements.length).toBeGreaterThan(0);
  });

  it("says 'cycle', never a bare 'month', once a payday is set", () => {
    // A range ("27 Sep - 26 Oct") and month NAMES are fine -- those name
    // real dates. Only the bare noun is a false period claim.
    expect(copyAt(27).filter((m) => /\bmonths?\b/i.test(m))).toEqual([]);
  });

  it("PREMISE: the same fixtures fire the same string types at startDay 1", () => {
    const over = computeDashboard(overspent(undefined));
    const strk = computeDashboard(streaking(undefined));
    expect(over.alerts.some((a) => a.id.startsWith("budget-"))).toBe(true);
    expect(strk.streaks.some((s) => s.key === "savings-streak")).toBe(true);
  });

  it("still says 'month' at startDay 1, so nothing changed for a default account", () => {
    const copy = copyAt(undefined);
    expect(copy.some((m) => /\bmonths?\b/i.test(m))).toBe(true);
    expect(copy.some((m) => /\bcycles?\b/i.test(m))).toBe(false);
  });

  it("the streak counts CYCLES and says so -- the unit and the noun agree", () => {
    const s = computeDashboard(streaking(27)).streaks.find((x) => x.key === "savings-streak");
    expect(s!.message).toMatch(/\d+ cycles in a row/);
  });
});
