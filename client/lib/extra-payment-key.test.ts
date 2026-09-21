// 2.4.126: the "+extra" payment gets a key, and it is NOT recurringId.
//
// `Extra: ${rec.name}` (InputPanel's logExtraPayment) was the one writer of
// English prose into a transaction that carried no foreign key at all --
// named in 2.4.122's table as the site most likely to attract a
// `description.startsWith("Extra:")` reader. This adds the key before that
// happens. Nothing reads it yet; that is the point.
//
// THE COUNTERFACTUAL IS THE FIRST TEST HERE, deliberately. Choosing a field
// is a judgement, and a judgement recorded only in prose is one nobody can
// re-check. These tests build the transaction BOTH ways and assert what each
// existing reader does with it, so "recurringId was wrong" is a result rather
// than an argument.
//
// WHICH INPUTS THESE FIXTURES CANNOT REACH (2.4.116):
//
//   * the UI path. logExtraPayment builds its transaction inline rather than
//     through a builder (the only writer in this file's family that does --
//     buildDebtPaymentTx, buildGoalContributionTx, buildRecurringConfirmLog,
//     buildEfAdjustmentTx and buildTransferTx are all extracted). So the
//     stamp itself is asserted in the component test alongside this file;
//     what lives here is every consequence of the field CHOICE, which is
//     pure. Extracting a builder would be the tidier shape and is NOT done
//     here -- it is an unrequested refactor (Rule 3), named rather than
//     silently skipped.
//   * whether an extra payment SHOULD count toward totalAmount. Left open on
//     purpose -- see the last describe block.
import { describe, it, expect } from "vitest";
import {
  isCycleConfirmed, recurringPaidSoFar, purgeTransaction,
  type StoredRecurring, type StoredTransaction,
} from "./localData";

const REC: StoredRecurring = {
  id: "r1", name: "Uni", emoji: "U", amount: 750, currency: "USD",
  frequency: "monthly", bucket: "NEEDS",
  startDate: "2026-01-15", endDate: null, totalAmount: 6750,
  createdAt: "2026-01-15T00:00:00.000Z",
};

/** The due date an extra payment is most likely to collide with: the one the bill itself is paid on. */
const DUE = new Date(Date.UTC(2026, 8, 15));
const DUE_ISO = "2026-09-15";

/** What logExtraPayment builds, minus the linking field. */
const extraBase = (): StoredTransaction => ({
  id: "x1", amount: 200, currency: "USD", bucket: "NEEDS",
  description: "Extra: Uni", date: DUE_ISO, paymentMethod: "cash",
});

/** A real confirmation, for contrast. */
const confirmed: StoredTransaction = {
  id: "c1", amount: 750, currency: "USD", bucket: "NEEDS",
  description: "Uni", date: DUE_ISO, cycleDate: DUE_ISO, recurringId: "r1",
};

// ─────────── 1. the counterfactual: why not recurringId ───────────

describe("1. THE COUNTERFACTUAL — what recurringId would have done", () => {
  it("would have SILENTLY CONFIRMED a cycle nobody confirmed", () => {
    // isCycleConfirmed falls back to `date` when cycleDate is absent:
    //   (t.cycleDate ?? t.date) === dueISO
    // An extra payment has no cycleDate and is dated today, and the likeliest
    // day to log one is the day the bill is paid -- the due date. This is the
    // modal case, not a contrived collision.
    const wrong: StoredTransaction = { ...extraBase(), recurringId: "r1" };
    expect(isCycleConfirmed(REC, DUE, [wrong])).toBe(true);   // <- the hazard, demonstrated
    // Consequence, spelled out: the cycle reads settled, so it stops being
    // overdue and nextConfirmTarget moves past it, with no settlement behind
    // it. That is the class Phase 2.5 exists to remove.
  });

  it("would have counted toward the totalAmount cap", () => {
    // recurringPaidSoFar filters on recurringId alone, no cycleDate clause.
    const wrong: StoredTransaction = { ...extraBase(), recurringId: "r1" };
    expect(recurringPaidSoFar(REC, [wrong])).toBe(200);
  });

  it("recurringId + cycleDate:null dodges the confirm but overloads a sentinel", () => {
    // Recorded because it is the cheaper alternative and it genuinely works
    // for the first problem -- isCycleConfirmed rejects explicit null
    // outright. It was rejected for what it costs, not for not working:
    // null means "deliberately detached" (2.4.32, a user's act), and reusing
    // it for "was never attached" (a property of the kind) makes the two
    // indistinguishable forever.
    const alt: StoredTransaction = { ...extraBase(), recurringId: "r1", cycleDate: null };
    expect(isCycleConfirmed(REC, DUE, [alt])).toBe(false);
    // ...but it still feeds the cap, so it does not settle that question either.
    expect(recurringPaidSoFar(REC, [alt])).toBe(200);
  });
});

// ─────────── 2. the field that shipped ───────────

describe("2. extraForRecurringId — inert to every existing reader", () => {
  const extra: StoredTransaction = { ...extraBase(), extraForRecurringId: "r1" };

  it("does not confirm the cycle it collides with", () => {
    expect(isCycleConfirmed(REC, DUE, [extra])).toBe(false);
  });

  it("does not count toward the totalAmount cap", () => {
    expect(recurringPaidSoFar(REC, [extra])).toBe(0);
  });

  it("does not disturb a real confirmation sitting beside it", () => {
    // Premise: the real confirmation IS counted, so the zero above is the
    // extra payment being ignored rather than the fixture being inert.
    expect(recurringPaidSoFar(REC, [confirmed])).toBe(750);
    expect(recurringPaidSoFar(REC, [confirmed, extra])).toBe(750);
    expect(isCycleConfirmed(REC, DUE, [confirmed, extra])).toBe(true);
  });

  it("is dropped by purgeTransaction", () => {
    // purgeTransaction builds a fresh object from an allowlist, so a new
    // field is dropped by construction rather than by remembering to add it.
    // Asserted anyway: the allowlist shape is the safety property, and a
    // future rewrite to a denylist would break it silently.
    const purged = purgeTransaction({ ...extra, deletedAt: "2026-09-20T00:00:00.000Z" });
    expect(purged.extraForRecurringId).toBeUndefined();
    expect(purged.recurringId).toBeUndefined();
    expect(purged.goalId).toBeUndefined();
  });
});

// ─────────── 3. the question this deliberately leaves open ───────────

describe("3. NOT DECIDED HERE — whether an extra payment should reduce the cap", () => {
  it("records the current answer as 'no', and that it is a default rather than a ruling", () => {
    // An extra payment on a capped item arguably DOES reduce what is owed,
    // which would make counting it correct. The opposite is also defensible:
    // recurringPaidSoFar's contract is "cycles settled", and $200 that
    // settles no cycle shrinking the number of cycles the item will ever
    // offer is its own kind of wrong -- 2.4.31's shape, inverted.
    //
    // The separate field is what keeps the question ASKABLE. Under
    // recurringId it would have been answered "yes", permanently, by a field
    // name. This assertion pins today's behaviour so a future change to it is
    // a deliberate edit to a test that says so, not a silent drift.
    const extra: StoredTransaction = { ...extraBase(), extraForRecurringId: "r1" };
    expect(recurringPaidSoFar(REC, [extra])).toBe(0);
  });
});
