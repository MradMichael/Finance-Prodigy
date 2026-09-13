// 2.4.81 / 2.4.82 — the shared projection anchor.
//
// ZERO-DIFF REGRESSION. Threading one explicit anchor through the cascade,
// both comparison columns, Journey and computeDashboard's debt plan — and
// making the parameter required so omission stops compiling — must change
// NO rendered date and NO month count.
//
// Every expectation below was captured by running this file against the
// PRE-refactor code and confirmed green there before a line of the refactor
// was written. That is why hardcoded values are correct here rather than an
// instance of reading expectations off the implementation (2.4.76): the
// baseline IS the old behaviour, and the assertion is that it survives. If
// one of these moves, the refactor is wrong — the finding is the moved
// date, not a stale expectation to adjust.
//
// The pair-agreement locks (2.4.81) and cross-screen identity are written
// against the exposed anchor, so they only exist post-refactor.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ProjectionsScreen from "./ProjectionsScreen";
import JourneyScreen from "./JourneyScreen";
import { computeDashboard, dateFmt } from "../../lib/computeDashboard";
import { addMonths } from "../../lib/debtEngine";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

// Pinned so every date is deterministic. Mid-month on purpose: an anchor
// bug that rounds to a month boundary would be invisible on the 1st.
const NOW = new Date(2026, 8, 13); // 13 September 2026

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

/**
 * Reaches every stage: income so the plan runs, an unmet safety net, live
 * debt, an open goal. Deliberately NOT the owner's real export — this file
 * asserts exact dates and must not drift when real data changes.
 */
function makeData(overrides: Partial<LocalFinancials> = {}): LocalFinancials {
  return {
    ...DEFAULT_DATA,
    income: 3000,
    budgetRule: "50-30-20",
    emergencyFundBalance: 1000,
    emergencyFundTargetMonths: 3,
    debts: [
      { id: "d1", name: "Card", openingBalance: 2000, apr: 18, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    goals: [
      { id: "g1", name: "Trip", targetAmount: 4000, currentAmount: 0, currency: "USD", targetDate: "2028-06-01", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    ...overrides,
  } as LocalFinancials;
}

/** A PaceRow's three lines: label, date, "N months away". */
function readPaceRow(label: string): string[] {
  const el = screen.getByText(label);
  return Array.from(el.parentElement!.querySelectorAll("p")).map((p) => p.textContent ?? "");
}

/** "In your plan" appears once per pair, so these are read positionally. */
function readInYourPlan(index: number): string[] {
  const rows = screen.getAllByText("In your plan");
  return Array.from(rows[index].parentElement!.querySelectorAll("p")).map((p) => p.textContent ?? "");
}

function renderProjections(overrides: Partial<LocalFinancials> = {}) {
  const data = makeData(overrides);
  const dash = computeDashboard(data);
  render(<ProjectionsScreen financials={data} dashData={dash} />);
  return dash;
}

describe("shared projection anchor — zero-diff regression", () => {
  it("the safety-net pair renders the same two dates and month counts as before", () => {
    renderProjections();
    expect(readPaceRow("At recommended pace")).toEqual(["At recommended pace", "13-05-2027", "8 months away"]);
    expect(readInYourPlan(0)).toEqual(["In your plan", "13-05-2027", "8 months away"]);
  });

  it("the debt pair renders the same two dates and month counts as before", () => {
    renderProjections();
    expect(readPaceRow("Your current plan")).toEqual(["Your current plan", "13-12-2026", "3 months away"]);
    expect(readInYourPlan(1)).toEqual(["In your plan", "13-09-2027", "4 months away"]);
  });

  it("EVERY date rendered anywhere on the screen is unchanged, in order", () => {
    // The strongest form of the gate: not a sampled row, the whole screen.
    // Includes the stability headline and the goal's own target date, which
    // is not anchor-derived and must also hold still.
    renderProjections();
    const all = (document.body.textContent ?? "").match(/\d{2}-\d{2}-\d{4}/g);
    expect(all).toEqual([
      "13-06-2028", // stability headline
      "13-05-2027", // timeline chip: safety net
      "13-09-2027", // timeline chip: debt
      "13-06-2028", // timeline chip: goals
      "13-05-2027", // safety net — at recommended pace
      "13-05-2027", // safety net — in your plan
      "13-12-2026", // debt — your current plan
      "13-09-2027", // debt — in your plan
      "01-06-2028", // the goal's own target date (not anchor-derived)
      "13-06-2028", // goals — in your plan
    ]);
  });

  it("Journey's safety-net date is unchanged too — the other site that omitted the argument", () => {
    const data = makeData();
    render(<JourneyScreen financials={data} dashData={computeDashboard(data)} onNavigate={vi.fn()} />);
    expect(document.body.textContent).toContain("13-05-2027");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PAIR-AGREEMENT LOCKS (2.4.81, 2.4.82).
//
// These are the tests that did not exist and would have caught the hazard.
// They assert each rendered date equals the shared anchor advanced by that
// row's own cumulative month count -- so a change that moves one column of
// a grid-cols-2 and leaves the other fails here, rather than rendering two
// dates a month apart under a layout that says they are comparable.
//
// Written against dashData.anchor deliberately: when the anchor's VALUE
// eventually changes (projections starting next month, still an open
// decision), these keep passing only if every column follows it together.
describe("pair-agreement locks (2.4.81) — every column derives from the one anchor", () => {
  const fromAnchor = (dash: ReturnType<typeof computeDashboard>, months: number) =>
    dateFmt(addMonths(dash.anchor, months));

  it("safety net: both columns of the grid are the anchor advanced by their own month counts", () => {
    const dash = renderProjections();
    const left = readPaceRow("At recommended pace");
    const right = readInYourPlan(0);
    expect(left[1]).toBe(fromAnchor(dash, 8));
    expect(right[1]).toBe(fromAnchor(dash, 8));
    // And the pair agrees with itself -- the assertion the layout implies.
    expect(left[1]).toBe(right[1]);
  });

  it("debt: the two columns legitimately differ, but both trace to the same anchor", () => {
    const dash = renderProjections();
    // Left ("Your current plan") comes from computeDashboard's debt.plan;
    // right ("In your plan") comes from the cascade, starting after the
    // safety net's 8 months. Different numbers, one anchor.
    expect(readPaceRow("Your current plan")[1]).toBe(fromAnchor(dash, 3));
    expect(readInYourPlan(1)[1]).toBe(fromAnchor(dash, 8 + 4));
  });

  it("the stability headline is the anchor advanced by the full plan length", () => {
    const dash = renderProjections();
    const all = (document.body.textContent ?? "").match(/\d{2}-\d{2}-\d{4}/g)!;
    expect(all[0]).toBe(fromAnchor(dash, 21)); // 8 EF + 4 debt + 9 goals
  });
});

describe("cross-screen identity — Journey and Projections answer from one anchor", () => {
  it("Journey's safety-net date is byte-identical to Projections' 'At recommended pace'", () => {
    const data = makeData();
    const dash = computeDashboard(data);

    render(<ProjectionsScreen financials={data} dashData={dash} />);
    const projectionsDate = readPaceRow("At recommended pace")[1];
    cleanup();

    render(<JourneyScreen financials={data} dashData={dash} onNavigate={vi.fn()} />);
    expect(document.body.textContent).toContain(projectionsDate);
    // Both must equal the anchor advanced by the same count -- not merely
    // equal each other, which two identically-wrong values would also satisfy.
    expect(projectionsDate).toBe(dateFmt(addMonths(dash.anchor, 8)));
  });
});
