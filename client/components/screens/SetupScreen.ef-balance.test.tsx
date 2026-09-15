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

describe("input that is not a number is discarded, not read as zero", () => {
  // FIXED (2.4.104). This was `parseFloat(raw) || 0`, so an emptied field
  // read as "my balance is now zero" and committed a correction of -balance,
  // wiping the fund. commitLbpRate discards the same input on the Currency
  // screen; the two now agree.
  //
  // Discard, not clamp: clamping to 0 would still wipe the fund, just
  // deliberately. Typing 0 IS an instruction and still works (below); an
  // empty or unparseable field is not one.
  it("an emptied field writes nothing", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup();
    // The real path: clearing fires onChange (draft := ""), then blur
    // commits. Driving blur directly with a target value would skip the
    // draft update and test a state the UI cannot actually be in.
    await user.clear(field());
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a whitespace-only field writes nothing either", () => {
    const { onChange } = renderSetup();
    fireEvent.blur(field(), { target: { value: "   " } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("PASTED unparseable text writes nothing -- the case a typed letter cannot reach", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup();
    // Premise, and the reason this test exists separately from the typed
    // case below: a number input silently swallows typed letters, so typing
    // can never produce a non-numeric value for the handler to mishandle.
    // Pasting can, and so can autofill.
    await user.clear(field());
    await user.type(field(), "abc");
    expect(field().value).toBe("");
    await user.click(field());
    await user.paste("abc");
    fireEvent.blur(field(), { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discarding restores the field to the real balance rather than leaving it blank", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup();
    await user.clear(field());
    // Premise: the field really was emptied, so the restore below is a
    // restore and not just an untouched initial render.
    expect(field().value).toBe("");
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    // The draft is cleared on every commit path, so the input falls back to
    // the derived value -- a discarded edit must not leave the field looking
    // like the balance is now empty.
    expect(field().value).toBe(String(OPENING));
  });

  it("typing 0 still zeroes the fund -- that IS an instruction, and must keep working", async () => {
    const user = userEvent.setup();
    const { onChange, data } = renderSetup();
    await user.clear(field());
    await user.type(field(), "0");
    await user.tab();
    // The pair to the discard tests: the fix must not have made a real
    // request to zero the balance impossible.
    expect(theAdjustment(onChange, data.transactions).efAmount).toBe(-OPENING);
  });

  it("a negative balance is clamped to 0 rather than written as negative", async () => {
    const user = userEvent.setup();
    const { onChange, data } = renderSetup();
    await user.clear(field());
    await user.type(field(), "-50");
    await user.tab();
    // Math.max(0, ...) -- an EF balance below zero is not a real state, and
    // unlike an empty field this is a deliberate entry.
    expect(theAdjustment(onChange, data.transactions).efAmount).toBe(-OPENING);
  });
});
