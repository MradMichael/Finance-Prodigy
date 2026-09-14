// Setup's Current-balance field -- the only control on Setup that writes to
// the LEDGER rather than to a setting.
//
// Every other field on this screen edits `financials` directly (income, name,
// payday, target months). This one calls buildEfAdjustmentTx and prepends a
// real StoredTransaction, because since Phase 2.6.3c the emergency-fund
// balance is DERIVED (`derivedEfBalance` = opening balance + every efAmount)
// rather than stored. So "set my balance to X" has to be expressed as a
// correction of `X - currentBalance`, and getting the sign or the trigger
// wrong writes a wrong number into the ledger permanently.
//
// Coverage note: 2.4.92 recorded SetupScreen at zero tests after the LBP rate
// field moved to Currency. That is no longer strictly true -- the payday field
// brought SetupScreen.payday.test.tsx with it -- but the EF field has had none
// until now, and it is the higher-consequence of the two.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupScreen from "./SetupScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../../lib/localData";

afterEach(() => { cleanup(); });

const OPENING = 1000;

function renderSetup(overrides: Partial<LocalFinancials> = {}) {
  const data = {
    ...DEFAULT_DATA, income: 3000,
    emergencyFundOpeningBalance: OPENING,
    emergencyFundTargetMonths: 3,
    transactions: [],
    ...overrides,
  } as LocalFinancials;
  const onChange = vi.fn();
  render(<SetupScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}

const field = () => screen.getByLabelText(/Current balance/i) as HTMLInputElement;

/**
 * The transactions the LAST onChange call wrote, or undefined if it never
 * fired. Reads the last call rather than searching all of them: "some call
 * wrote a correction" is the collection-shaped premise 2.4.97 warns about.
 */
function written(onChange: ReturnType<typeof vi.fn>): StoredTransaction[] | undefined {
  const calls = onChange.mock.calls;
  return calls.length ? (calls[calls.length - 1][0] as LocalFinancials).transactions : undefined;
}

/** The one transaction this commit prepended, asserted to be exactly one. */
function theAdjustment(onChange: ReturnType<typeof vi.fn>, before: StoredTransaction[]): StoredTransaction {
  const after = written(onChange);
  expect(after, "onChange never fired, so there is no adjustment to inspect").toBeTruthy();
  expect(after!.length).toBe(before.length + 1);
  return after![0]; // prepended
}

describe("the field is seeded from the DERIVED balance, not a stored one", () => {
  it("shows opening balance plus every efAmount already in the ledger", () => {
    // Premise for every delta assertion below: the number the field starts
    // from is 1250, so a commit of 1500 must produce +250 and not +500.
    renderSetup({
      transactions: [{ id: "e1", amount: 0, currency: "USD", bucket: "SAVINGS",
        description: "prior correction", date: "2026-09-01", efAmount: 250 } as StoredTransaction],
    });
    expect(field().value).toBe("1250");
  });
});

describe("committing a changed balance writes exactly one correction", () => {
  it("an INCREASE writes a positive efAmount equal to the difference", async () => {
    const user = userEvent.setup();
    const { onChange, data } = renderSetup();
    // Premise: the field really is starting from OPENING, so 1500 - 1000
    // is the delta under test.
    expect(field().value).toBe(String(OPENING));
    await user.clear(field());
    await user.type(field(), "1500");
    await user.tab();
    const tx = theAdjustment(onChange, data.transactions);
    expect(tx.efAmount).toBe(500);
    expect(tx.bucket).toBe("SAVINGS");
    expect(tx.description).toBe("Emergency fund balance correction");
    // amount 0 is load-bearing: a correction must not move any spend total.
    expect(tx.amount).toBe(0);
    expect(tx.paymentMethod).toBe("other");
    expect(tx.currency).toBe("USD");
  });

  it("a DECREASE writes a negative efAmount, not a positive one", async () => {
    const user = userEvent.setup();
    const { onChange, data } = renderSetup();
    await user.clear(field());
    await user.type(field(), "800");
    await user.tab();
    expect(theAdjustment(onChange, data.transactions).efAmount).toBe(-200);
  });

  it("the correction lands on the derived balance, closing the loop", async () => {
    const user = userEvent.setup();
    const { onChange, data } = renderSetup();
    await user.clear(field());
    await user.type(field(), "1500");
    await user.tab();
    // The real test of the sign: recompute from the written ledger and check
    // the balance is what was typed. An efAmount with the wrong sign passes
    // an equality check on 500 only if you assert the wrong number too.
    const after = { ...data, transactions: written(onChange)! } as LocalFinancials;
    expect(computeDashboard(after).emergencyFund.balance).toBe(1500);
  });

  it("a fractional correction is rounded to cents, not left as float noise", async () => {
    const user = userEvent.setup();
    const { onChange, data } = renderSetup();
    await user.clear(field());
    await user.type(field(), "1000.105");
    await user.tab();
    expect(theAdjustment(onChange, data.transactions).efAmount).toBe(0.11);
  });
});

describe("commit is on blur, never on a keystroke", () => {
  it("typing does not write -- every prefix of 1500 would be a different correction", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup();
    await user.clear(field());
    // Passes through "1", "15", "150" -- each a valid number, each a
    // catastrophic correction if committed (1 - 1000 = -999). This is the
    // property commitLbpRate's strongest test asserts, for the same reason.
    await user.type(field(), "1500");
    expect(onChange).not.toHaveBeenCalled();
    expect(field()).toHaveValue(1500);
    await user.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("an unchanged value writes nothing -- clicking in and out is not an edit", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup();
    await user.click(field());
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("retyping the same number writes nothing either -- delta 0, not 'the field was touched'", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup();
    await user.clear(field());
    await user.type(field(), String(OPENING));
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("input that is not a number", () => {
  // See the report accompanying this branch. `parseFloat("") || 0` is 0, so
  // an emptied field is read as "my balance is now zero" and commits a
  // correction of -balance. commitLbpRate discards this exact case; this
  // field does not, and the failure direction here is destructive.
  //
  // These are it.fails: they state the CORRECT expectation and record that it
  // does not hold today. Encoding the current behaviour as passing would lock
  // the bug in. When the fix lands, it.fails starts failing and forces its own
  // removal -- which a skip would not.
  it.fails("EMPTY input should be discarded, as commitLbpRate discards it (CURRENTLY WIPES THE FUND)", () => {
    const { onChange } = renderSetup();
    fireEvent.blur(field(), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("documents what empty input does today, so the size of the bug is on record", () => {
    const { onChange, data } = renderSetup();
    fireEvent.blur(field(), { target: { value: "" } });
    // Premise: it wrote at all -- the assertion below is about WHAT it wrote.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(theAdjustment(onChange, data.transactions).efAmount).toBe(-OPENING);
    const after = { ...data, transactions: written(onChange)! } as LocalFinancials;
    expect(computeDashboard(after).emergencyFund.balance).toBe(0);
  });

  it.fails("UNPARSEABLE input should be discarded too (CURRENTLY WIPES THE FUND)", () => {
    const { onChange } = renderSetup();
    // Reaches the handler the way a paste or autofill would; a typed letter
    // is swallowed by the number input before it ever gets here.
    fireEvent.blur(field(), { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a negative balance is clamped to 0 rather than written as negative", async () => {
    const user = userEvent.setup();
    const { onChange, data } = renderSetup();
    await user.clear(field());
    await user.type(field(), "-50");
    await user.tab();
    // Math.max(0, ...) -- an EF balance below zero is not a real state.
    // Distinct from the empty case: here the user did ask for a wipe.
    expect(theAdjustment(onChange, data.transactions).efAmount).toBe(-OPENING);
  });
});
