// Performance assertions for the recurring-cycle walk (2.4.109).
//
// WHY THIS FILE EXISTS. The cost diagnosed in 2.4.109 was reported for weeks
// as a flaky ProjectionsScreen timeout. It was never a race -- those tests
// are fully synchronous -- so the 5000ms default timeout had accidentally
// become the only automated check on a ~350ms main-thread freeze that three
// real screens pay per render. Raising the timeout, the obvious remedy,
// would have deleted the measurement and kept the defect.
//
// A timeout must never be that signal again. These assert the ALGORITHMIC
// properties directly, so a regression fails on its own terms.
//
// THREE OF THE FOUR ARE RATIOS, ON PURPOSE. An absolute millisecond budget
// is a statement about the machine as much as about the code. A ratio
// between two measurements taken moments apart on the same machine is not:
// it says "this must not cost more than that", which is what the defect
// actually violates. Each ratio has a known-good control measured in the
// same run -- an endDate-bounded item for the horizon, weekly for the loop.
//
// They shipped as `it.fails`: each states the property that SHOULD hold and
// records that it does not, and begins failing the moment a fix lands,
// forcing its own promotion to `it` -- which a skip would not.
//
// STATUS -- all four now hold. The two fixes, and which assertion each one
// moved, measured rather than argued:
//
//                      on main    after Fix 1   after Fix 2
//   A  horizon waste     368ms      0.061ms       0.020ms    GREEN at Fix 1
//   D  absolute          516ms      1.26ms        0.021ms    GREEN at Fix 1
//   B  monthly/weekly     97.8x     214x          3.21x      GREEN at Fix 2
//   C  age growth          3.25x     70.7x        1.07x      GREEN at Fix 2
//
// The middle column is the evidence that BOTH fixes were needed, and it was
// a prediction recorded before either landed: bounding the walk (Fix 1)
// removes cycles but makes no single nextOccurrence call cheaper, so B was
// untouched and C got worse -- 9 cycles x O(age) is still O(age) once the
// constant 1194-cycle term is gone. Only the closed form (Fix 2) flattens
// age dependence, and C at 1.07x is what "flat" looks like.
import { describe, it, expect } from "vitest";
import { capacityFreedFrom, nextOccurrence, nominalMonthlyEquivalent, recurringPaidSoFar, type StoredRecurring, type StoredTransaction } from "./localData";

const NOW = new Date(2026, 6, 15); // 15 Jul 2026, matching ProjectionsScreen.test.tsx

function item(frequency: string, startYear: number, over: Partial<StoredRecurring> = {}): StoredRecurring {
  return {
    id: `${frequency}-${startYear}`, name: "Item", emoji: "", amount: 750, currency: "USD",
    frequency, bucket: "NEEDS", startDate: `${startYear}-01-01`, endDate: null,
    totalAmount: 6750, createdAt: `${startYear}-01-01T00:00:00.000Z`,
    ...over,
  } as unknown as StoredRecurring;
}

/**
 * Median of `samples` timings, each the mean of `batch` calls.
 *
 * Median across samples so one GC pause cannot decide the result, and a
 * discarded warm-up pass so the first sample is not measuring JIT. Batching
 * matters once a fix lands: a single closed-form call is below timer
 * resolution, and a ratio of two rounding errors is not a measurement. The
 * first draft of this file omitted the warm-up and took a mean of five --
 * it reported an age ratio of 3.5x where the real figure is 1.9x.
 * 📐 HELD QUESTION: min instead of median (raised 2026-09-22).
 *
 * Under contention the FASTEST sample is the one least interrupted, so min
 * is the better estimator of the code's own cost -- median still carries
 * scheduler noise, which is what made assertion E2's budget unsurvivable
 * (0.61ms isolated vs a 5.64ms tail, a 9.2x swing).
 *
 * NOT CHANGED, and the reason is scope rather than doubt: this helper is
 * shared by A, B, C, D and E. Switching to min silently re-tunes four
 * assertions that are currently stable and whose margins were calibrated
 * against median's numbers -- B and C are ratios where both sides would
 * move, and D's 1,000x margin would simply grow. That is its own change,
 * with its own before/after measurements, not a rider on a budget fix.
 *
 */
function median(fn: () => unknown, { batch = 1, samples = 7 } = {}): number {
  for (let i = 0; i < batch; i++) fn();
  const times: number[] = [];
  for (let s = 0; s < samples; s++) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) fn();
    times.push((performance.now() - t0) / batch);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

describe("A. the walk must not build cycles it discards (cause 1: the 100-year horizon)", () => {
  // The control is the same item with an endDate that yields the IDENTICAL
  // answer -- so the two calls do the same job and differ only in how much
  // of the calendar they walk to do it. That is the cleanest possible
  // statement of "this work is waste": not "it is slow", but "it is slower
  // than the same question asked a way that happens to bound the walk".
  //
  // REFRAMED WHEN FIX 1 LANDED, rather than left to pass for the wrong
  // reason. The original form asserted a <=5x RATIO against the
  // endDate-bounded control. That control returns at localData.ts:1533
  // without walking at all, so its cost is ~0.0003ms and a 5x ratio was
  // never reachable -- post-fix the ratio is still 187x while the absolute
  // cost is 0.06ms. The `+ 2ms` floor, added only to avoid dividing by
  // timer noise, was doing all the work. An assertion whose stated form is
  // unreachable is not an assertion, so the ratio is now a PREMISE (the two
  // answers must match, which is what makes the extra work discardable) and
  // the budget is absolute.
  //
  // Measured: 368ms before Fix 1, 0.061ms after -- a ~6000x improvement,
  // against a 2ms budget with a ~30x margin.
  it("an unbounded capped item resolves in under 2ms, doing work proportional to its 9 installments (WAS 368ms)", () => {
    const unbounded = item("monthly", 2026);
    const bounded   = item("monthly", 2026, { endDate: "2027-05-01" });
    // Premise, and the whole force of this test: the answers are the same,
    // so every extra cycle the unbounded walk builds is discarded.
    const a = capacityFreedFrom(unbounded, [], NOW);
    const b = capacityFreedFrom(bounded, [], NOW);
    expect(a).toBeInstanceOf(Date);
    expect(a!.toISOString()).toBe(b!.toISOString());

    const tUnbounded = median(() => capacityFreedFrom(unbounded, [], NOW), { batch: 50 });
    expect(tUnbounded).toBeLessThan(2);
  });
});

describe("B. monthly must not cost dramatically more than weekly (cause 2: the loop)", () => {
  // nextOccurrence's day-frequency branch is already closed-form O(1); the
  // monthly branch loops from startDate on every call. Weekly is therefore
  // a known-good control for the identical query on the same machine in the
  // same run -- if monthly is far slower, the loop is the only difference.
  //
  // On main 97.8x (122.8us vs 1.26us); after Fix 1, 214x -- untouched, as
  // predicted, because bounding the walk removes cycles without making any
  // single call cheaper. After Fix 2: 1.71us vs 0.53us, 3.21x. The residual
  // gap is the month-index arithmetic and the one or two clamp corrections,
  // which is what a closed form costs over a subtraction.
  it("monthly nextOccurrence is within 5x of weekly at the same item age (WAS ~98x)", () => {
    const monthly = item("monthly", 2006);
    const weekly  = item("weekly", 2006);
    const tMonthly = median(() => nextOccurrence(monthly, NOW), { batch: 500 });
    const tWeekly  = median(() => nextOccurrence(weekly, NOW),  { batch: 500 });
    // Premise: weekly is measurable at this batch size, so the ratio is not
    // dividing by a timer-resolution artifact.
    expect(tWeekly).toBeGreaterThan(0);
    expect(tMonthly / tWeekly).toBeLessThan(5);
  });
});

describe("C. cost must not grow with an item's age (cause 2, from the other side)", () => {
  // The age effect is secondary to the horizon but it is the part that gets
  // worse on its own, with no user action, every year an item exists.
  //
  // On main: 2026 start 276.8ms, 1950 start 900.1ms -- 3.25x. (A 2006 start
  // is 515.8ms, 1.86x, which is why this uses 1950: the 20-year ratio sits
  // too close to the threshold to discriminate reliably.)
  //
  // PREDICTION MADE BEFORE FIX 1, AND CONFIRMED BY IT: fixing cause 1 alone
  // would make this ratio WORSE in relative terms even as both sides became
  // fast, because 9 cycles x O(age) is still O(age) once the constant
  // 1194-cycle term is gone. Measured after Fix 1: 0.058ms vs 4.124ms --
  // 70.7x, up from 3.25x. Absolutely ~200x faster on both sides; relatively
  // far more age-dependent. This is the assertion that proved Fix 1 alone
  // was not sufficient for the cause, rather than that being asserted.
  //
  // After Fix 2: 0.0220ms vs 0.0235ms -- 1.07x. A 76-year-old item now
  // costs what a new one costs, which is the whole point of the closed
  // form and the thing no absolute budget would have checked.
  it("a 1950-start item costs no more than 2x a 2026-start one (WAS ~3.3x, and 70.7x after Fix 1 alone)", () => {
    const fresh = item("monthly", 2026);
    const aged  = item("monthly", 1950);
    const tFresh = median(() => capacityFreedFrom(fresh, [], NOW), { batch: 4, samples: 5 });
    const tAged  = median(() => capacityFreedFrom(aged, [], NOW),  { batch: 4, samples: 5 });
    // Premise: both did real, measurable work.
    expect(tFresh).toBeGreaterThan(0);
    expect(tAged / tFresh).toBeLessThan(2);
  });
});

describe("D. absolute backstop", () => {
  // Deliberately loose -- 50ms against a measured 516ms is a 10x margin, so
  // it will not flake on a slow CI box, and it still catches any regression
  // to anything resembling current behaviour. The ratios above are the real
  // assertions; this exists so a change that slows every side equally
  // cannot satisfy them while still being far too slow.
  // Measured: 516ms before Fix 1, 1.26ms after -- a 40x margin under the
  // budget. Kept at 50ms rather than tightened: this is the backstop for a
  // change that slows everything equally, and a tight backstop is a flaky
  // one.
  it("capacityFreedFrom on a 20-year-old monthly item completes in under 50ms (WAS ~516ms)", () => {
    const aged = median(() => capacityFreedFrom(item("monthly", 2006), [], NOW), { samples: 5 });
    expect(aged).toBeLessThan(50);
  });
});

describe("premise: the shape under test is the one the owner actually has", () => {
  // Not a performance assertion. It pins that the fixture is the
  // configuration that triggers the walk -- totalAmount set, endDate null --
  // so a future edit to item() that quietly made it cheap could not leave
  // the four assertions above passing for the wrong reason.
  it("the fixture is totalAmount-capped with no endDate, and a null-totalAmount item is the cheap control", () => {
    const capped = item("monthly", 2006);
    expect(capped.totalAmount).toBe(6750);
    expect(capped.endDate).toBeNull();
    // capacityFreedFrom returns null immediately when there is no cap to
    // resolve -- the control for "the expensive path was not entered".
    expect(capacityFreedFrom(item("monthly", 2006, { totalAmount: null }), [], NOW)).toBeNull();
    // And the capped one really does resolve, i.e. the measured path is the
    // one that does the work.
    expect(capacityFreedFrom(capped, [], NOW)).toBeInstanceOf(Date);
  });
});

describe("E. the 3N display path stays cheap now that it reads the ledger (2.4.112)", () => {
  // nominalMonthlyEquivalent became payment-aware, so it is O(transactions)
  // where it used to be O(1). RecurringScreen calls it 3N times per render
  // -- two reduces over every item plus one per row -- so this is the path
  // that had to be measured before the threading was approved.
  //
  // THRESHOLD REACHABILITY (2.4.111), and a correction to the calibration
  // this file was first written with. The stated justification was that
  // swapping recurringPaidSoFar for remainingInstallments -- the obvious-
  // looking call, ~28x dearer -- would cross the budget. MEASURED, that is
  // false at this ledger size: 0.596ms vs 0.693ms, a 16% difference. The
  // 28x gap is real only at SMALL ledgers, where the cycle walk dominates;
  // at 8,400 transactions remainingInstallments calls recurringPaidSoFar
  // internally and then walks four cycles, so the scan swamps it (2.4.113).
  // No sane threshold discriminates 16%, and claiming one would repeat
  // exactly the unreachable-threshold mistake 2.4.111 records.
  //
  // What these two DO catch is the regression that matters: any change that
  // reintroduces a per-call cycle walk. Undoing 2.4.109's bound would make
  // one call ~368ms and nine of them ~3.3s -- past both assertions by three
  // orders of magnitude.
  const ITEMS = 3;      // the owner's real count
  const CALLS = 3;      // RecurringScreen's 3N
  const LEDGER = 8400;  // 100x the owner's real 84
  const txs: StoredTransaction[] = Array.from({ length: LEDGER }, (_, i) => ({
    id: `t${i}`, amount: 10, currency: "USD", bucket: "WANTS", description: "x",
    date: "2026-05-01", recurringId: i % 21 === 0 ? "monthly-2026" : undefined,
  } as unknown as StoredTransaction));
  const items = Array.from({ length: ITEMS }, () => item("monthly", 2026));
  const render = () => {
    let total = 0;
    for (let c = 0; c < CALLS; c++) for (const r of items) total += nominalMonthlyEquivalent(r, txs, NOW);
    return total;
  };

  it("the wrapper costs no more than the ledger scan it performs -- no hidden walk per call", () => {
    // The real assertion, and a ratio against a control measured in the
    // same run: 3N wrapper calls must cost about 3N bare recurringPaidSoFar
    // calls, because that scan is all the wrapper legitimately does.
    // Measured 0.98x. A per-call cycle walk is what pushes this up.
    expect(recurringPaidSoFar(items[0], txs)).toBeGreaterThan(0); // premise: the scan runs
    const withWrapper = median(render, { batch: 20 });
    const bareScans = median(() => {
      let t = 0;
      for (let c = 0; c < CALLS; c++) for (const r of items) t += recurringPaidSoFar(r, txs);
      return t;
    }, { batch: 20 });
    expect(bareScans).toBeGreaterThan(0);
    expect(withWrapper / bareScans).toBeLessThan(3);
  });

  it("and stays under 50ms in absolute terms at 100x the real ledger", () => {
    // Backstop, per assertion D's reasoning: a change that slows the wrapper
    // and its control equally satisfies the ratio above while still being far
    // too slow. That is the ONE regression the ratio is structurally blind to,
    // because it inflates both sides -- concretely, recurringPaidSoFar itself
    // getting slow.
    //
    // ⚠️ BUDGET CORRECTED 2026-09-22, from 5ms. It failed intermittently at
    // ~5.6ms under full-suite load, on main, before Phase 2 existed. The old
    // comment read "Measured 0.596ms, so ~8x inside -- stated plainly rather
    // than dressed up as tighter than it is." Every word of that was true,
    // and it is the sentence that should have prompted the question it did
    // not: **8x of WHAT variance?**
    //
    // THE GENERAL DEFECT, which is the part worth carrying elsewhere:
    //
    //   A margin calibrated against a single measurement is a margin against
    //   a POINT, not a distribution. State the variance the number has to
    //   survive, not just the value it was measured at.
    //
    // MEASURED, this workload (9 nominalMonthlyEquivalent calls over 8,400
    // transactions; median of 7 samples x 20 calls after a warm-up):
    //
    //   isolated, n=6              0.61 - 0.70 ms
    //   full suite, n=4            1.19 - 1.57 ms
    //   two suites concurrent, n=2 1.32 - 1.38 ms
    //   observed failure            ~5.64 ms
    //
    // The absolute swings 9.2x across conditions. An 8x margin cannot
    // survive a 9.2x swing; that is the whole bug, and it is arithmetic
    // rather than bad luck.
    //
    // WHY 50 AND NOT "whatever stops it failing": it is assertion D's
    // budget, and D has never flaked because its margin is ~1,000-2,200x
    // (measured 0.023ms isolated, 0.023-0.051ms under load). D is the same
    // shape of assertion on a workload 27x lighter, which is exactly why it
    // was never exposed to this.
    //
    // REACHABILITY (2.4.111). Failure needs 9 calls over 50ms, i.e. >5.5ms
    // per call against today's ~0.07ms -- an ~80x slowdown in
    // recurringPaidSoFar's per-call cost. Both named regressions clear that:
    // undoing 2.4.109's bound is ~368ms per call (~3.3s for nine, 66x past
    // the budget), and an O(n^2) scan at 8,400 rows is hundreds of ms.
    // WHAT IT WILL NOT CATCH: anything under ~80x. Said plainly -- that is
    // the price of an absolute backstop on a measurement with 9x
    // environmental variance, and it is why the RATIO above, not this, is
    // the real assertion.
    //
    // REJECTED, with measurements, so none of these is re-proposed blind:
    //
    //   * A same-run machine-speed control (one trivial pass over the same
    //     8,400-element array), normalising wrapper/calib. MEASURED: calib
    //     is 0.0069ms isolated but 0.0175 / 0.2463 / 0.3096 under load -- a
    //     45x swing, WORSE than its subject's 9.2x -- so wrapper/calib
    //     ranged 90.2 down to 3.6, a 25x spread. **A normaliser below its
    //     subject's noise floor makes the assertion worse, not better.** At
    //     ~7us it is beneath timer and scheduler granularity. The ratio
    //     technique is right in general and this file already uses it
    //     correctly in A, B, C and in the test above -- against `bare`,
    //     which is the same MAGNITUDE (0.85-1.20 across every condition).
    //   * min instead of median. Genuinely better under contention, and
    //     held as its own question -- see the note on `median` itself.
    //   * Deleting this test. Loses the only cover for "recurringPaidSoFar
    //     itself got slow".
    //   * 10-20ms. Still inside the observed 5.64ms tail by under 4x: buys a
    //     quieter suite, not a surviving one.
    expect(render()).toBeGreaterThan(0);
    expect(median(render, { batch: 20 })).toBeLessThan(50);
  });
});
