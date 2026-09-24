// The close dialog's currency defect — the UI half.
//
// The pure half (the worked example, the record's discrepancy, the two
// surfaces agreeing) is in lib/period-close.currency.test.ts. What is here is
// what only the component can answer: what the dialog PRINTS, which gaps it
// decides are worth offering an explanation for, what it copies into an
// acknowledgement, and whether its input is bounded.
//
// The acknowledgement case lives here rather than in the pure file for a
// reason worth stating: a pure test has to build the acknowledgement itself,
// and one built by hand from the right figure proves only that
// acknowledgementFor matches equal numbers. The defect is in what the DIALOG
// copies in, so the test has to drive the dialog.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * the rate changing between opening the dialog and confirming. The
//     converter is built at render from lbpRateHistory; driving a change
//     mid-dialog asserts the harness, not the behaviour.
//   * a non-USD, non-LBP currency. The union has two members.
//   * the MoneyInput's own clamp mechanics. Asserted here only as "the
//     ceiling is the account's, not unlimited"; the blur-not-keystroke
//     behaviour itself is 2.4.74's and is tested with the primitive.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import {
  DEFAULT_DATA, DEFAULT_LBP_RATE, MONEY_MAX_USD, acknowledgementFor,
  type LocalFinancials, type TrackedBalance,
} from "../../lib/localData";
import { asCycleKey } from "../../lib/period";

afterEach(() => { cleanup(); });

/** The owner's real case: 10,000,000 lira, expected $111.73 at 89,500. */
const LBP_TB: TrackedBalance = {
  id: "lbp1", name: "Lira jar", paymentMethod: "cash",
  startingBalance: 10_000_000, startingDate: "2026-08-01",
  startingAt: "2026-08-01T09:00:00.000Z", currency: "LBP",
  lbpRateAtEntry: DEFAULT_LBP_RATE,
};
const USD_TB: TrackedBalance = {
  id: "usd1", name: "Cash", paymentMethod: "cash",
  startingBalance: 500, startingDate: "2026-08-01",
  startingAt: "2026-08-01T09:00:00.000Z", currency: "USD",
};

function renderScreen(tbs: TrackedBalance[]) {
  const data = {
    ...DEFAULT_DATA, income: 3000, cycleStartDay: 27,
    trackedBalances: tbs, transactions: [],
  } as LocalFinancials;
  const onChange = vi.fn();
  render(<BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}
const written = (onChange: ReturnType<typeof vi.fn>): LocalFinancials =>
  onChange.mock.calls[onChange.mock.calls.length - 1][0] as LocalFinancials;

const openDialog = () => fireEvent.click(screen.getByRole("button", { name: /close this cycle/i }));
const amountFor = (name: string) => screen.getByLabelText(new RegExp(`what ${name} actually holds`, "i"));
const confirmClose = () => fireEvent.click(screen.getByRole("button", { name: /^close cycle$/i }));
/** The dialog offers exactly one of these per flagged row. */
const ackToggle = () => screen.queryByRole("checkbox", { name: /mark this gap as accounted for/i });

// ───────── 1. what the dialog says the figure is ─────────

describe("1. the row names the unit it is asking for", () => {
  it("an LBP account's input is labelled in lira", () => {
    // The comparison figures are USD and say so. The INPUT is native, and
    // before this it was labelled only "What Lira jar actually holds" with a
    // `$` expectation printed directly above it. A user who believes the `$`
    // and types 106 sets a baseline of 106 LIRA -- wrong by the rate, and
    // wrong in the stored anchor, not just in a readout.
    renderScreen([LBP_TB]);
    openDialog();
    expect(screen.getByLabelText(/what Lira jar actually holds/i)).toBeTruthy();
    // The account is deliberately NOT named "Cash LBP": the first version of
    // this test matched /LBP/ against a row containing the account's own
    // name, and passed against the unfixed code.
    const label = screen.getByText(/what Lira jar actually holds/i);
    expect(label.textContent).toContain("L£");
  });

  it("a USD account's input is labelled in dollars", () => {
    renderScreen([USD_TB]);
    openDialog();
    const label = screen.getByText(/what Cash actually holds/i);
    expect(label.textContent).toContain("$");
    expect(label.textContent).not.toContain("L£");
  });

  it("the gap is stated in the currency it was computed in", () => {
    // The expected line and the gap line are adjacent and must not disagree:
    // before the fix they read "expected $111.73" directly above
    // "Gap: L£9,494,888 unaccounted for." Same row, same comparison, two
    // currencies. A perturbation that printed the gap in the other unit was
    // caught by nothing until this was added.
    renderScreen([LBP_TB]);
    openDialog();
    fireEvent.change(amountFor("Lira jar"), { target: { value: "9500000" } });
    const line = screen.getByText(/unaccounted for/i);
    expect(line.textContent).toContain("$5.58");
    expect(line.textContent).not.toContain("L£");
  });
});

// ───────── 2. the >= $1 gate ─────────

describe("2. the acknowledgement gate is a DOLLAR threshold", () => {
  it("is not offered for an LBP count that is only cents out", () => {
    // 9,995,000 lira is $111.68 against an expected $111.73 -- five cents.
    // Subtracting the USD expected from the raw lira figure gives 9,994,888,
    // which clears `>= 1` by seven orders of magnitude, so Phase 2 offered
    // the explanation control on every LBP account at every close.
    renderScreen([LBP_TB]);
    openDialog();
    fireEvent.change(amountFor("Lira jar"), { target: { value: "9995000" } });
    expect(ackToggle()).toBeNull();
  });

  it("IS offered when the dollar gap is real", () => {
    // Premise for the test above: the control does appear when it should,
    // so its absence there is the threshold working and not the control
    // being broken or renamed.
    renderScreen([LBP_TB]);
    openDialog();
    fireEvent.change(amountFor("Lira jar"), { target: { value: "9500000" } });
    expect(ackToggle()).not.toBeNull();
  });
});

// ───────── 3. what the acknowledgement carries ─────────

describe("3. an acknowledgement made at the close can be found afterwards", () => {
  it("the copied discrepancy is in the same unit acknowledgementFor compares against", () => {
    // The fourth wrong output, and the one with the worst outcome: nothing
    // errors, the note is stored, and the badge it was written to clear
    // stays lit forever because -5.58 never equals 9,499,888.27.
    const { onChange } = renderScreen([LBP_TB]);
    openDialog();
    fireEvent.change(amountFor("Lira jar"), { target: { value: "9500000" } });
    fireEvent.click(ackToggle()!);
    fireEvent.change(screen.getByPlaceholderText(/cash withdrawal I never logged/i), {
      target: { value: "counted short, spent cash at the souk" },
    });
    confirmClose();

    const out = written(onChange);
    const acc = out.periodCloses![0].accounts[0];
    expect(acc.acknowledgement!.discrepancy).toBe(-5.58);

    // ...and the end-to-end consequence: the badge actually clears.
    const after = computeDashboard(out);
    const badge = after.balanceChecks[0];
    expect(badge.discrepancy).toBe(-5.58);
    expect(acknowledgementFor(out.trackedBalances![0], badge.discrepancy, out.periodCloses)).not.toBeNull();
    expect(badge.acknowledged).not.toBeNull();
  });
});

// ───────── 4. the input's ceiling ─────────

describe("4. the currency-aware bound is back", () => {
  it("a USD figure above the ceiling is clamped on blur", () => {
    // Phase 2's dialog passed max={Number.MAX_SAFE_INTEGER}, dropping the
    // ceiling for every account, not only non-USD ones. The check-in path
    // beside it kept moneyMaxFor(tb.currency, lbpRate) throughout.
    renderScreen([USD_TB]);
    openDialog();
    const input = amountFor("Cash");
    fireEvent.change(input, { target: { value: String(MONEY_MAX_USD + 1) } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value.replace(/,/g, "")).toBe(String(MONEY_MAX_USD));
  });

  it("an LBP figure is bounded by the LBP ceiling, not the dollar one", () => {
    // The bound has to scale with the currency or it would make a perfectly
    // ordinary lira balance untypable -- 10,000,000 is $111, far under the
    // dollar ceiling but far over it as a raw number.
    renderScreen([LBP_TB]);
    openDialog();
    const input = amountFor("Lira jar");
    fireEvent.change(input, { target: { value: "10000000" } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value.replace(/,/g, "")).toBe("10000000");
  });
});

// ───────── 5. WHICH rate converts ─────────

describe("5. the close converts at the closing cycle rate, not the live one", () => {
  it("a rate change since the cycle ended does not move the stated figure", () => {
    // expectedAtClose is built from historized rates, so converting the
    // figure the user states at today's rate would compare two moments --
    // 2.4.134's fault in a second dimension. Nothing pinned this choice
    // until a perturbation swapped it for the live rate and no test moved.
    const data = {
      ...DEFAULT_DATA, income: 3000, cycleStartDay: 27,
      trackedBalances: [LBP_TB], transactions: [],
      lbpRate: 100_000,
      lbpRateHistory: [{ ym: asCycleKey("2026-08"), value: 89_500 }],
    } as LocalFinancials;
    const onChange = vi.fn();
    render(<BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);

    // Premise: the two rates really do differ, or this asserts nothing.
    expect(data.lbpRate).not.toBe(89_500);

    openDialog();
    fireEvent.change(amountFor("Lira jar"), { target: { value: "8950000" } });
    confirmClose();
    const acc = written(onChange).periodCloses![0].accounts[0];
    // 8,950,000 / 89,500 = 100.00 exactly. At the live 100,000 it would
    // be 89.50 -- a different figure, and the wrong one.
    expect(acc.actualUSD).toBe(100);
    expect(acc.lbpRateAtClose).toBe(89_500);
  });
});
