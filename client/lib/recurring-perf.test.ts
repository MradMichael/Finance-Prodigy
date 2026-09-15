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
// These ship as `it.fails`: they state the property that SHOULD hold and
// record that it does not, and they begin failing the moment a fix lands,
// forcing their own promotion to `it` -- which a skip would not. Measured
// values on main at the time of writing are in each test.
import { describe, it, expect } from "vitest";
import { capacityFreedFrom, nextOccurrence, type StoredRecurring } from "./localData";

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
  // On main: unbounded 368ms, bounded 0.000ms, and both return 2027-05-01.
  it.fails("an unbounded capped item costs no more than an endDate-bounded one giving the same answer (CURRENTLY ~700,000x)", () => {
    const unbounded = item("monthly", 2026);
    const bounded   = item("monthly", 2026, { endDate: "2027-05-01" });
    // Premise, and the whole force of this test: the answers are the same,
    // so every extra cycle the unbounded walk builds is discarded.
    const a = capacityFreedFrom(unbounded, [], NOW);
    const b = capacityFreedFrom(bounded, [], NOW);
    expect(a).toBeInstanceOf(Date);
    expect(a!.toISOString()).toBe(b!.toISOString());

    const tUnbounded = median(() => capacityFreedFrom(unbounded, [], NOW), { samples: 5 });
    const tBounded   = median(() => capacityFreedFrom(bounded, [], NOW), { batch: 50 });
    // +2ms floor: the bounded call is below timer resolution, so a pure
    // ratio would divide by noise.
    expect(tUnbounded).toBeLessThan(tBounded * 5 + 2);
  });
});

describe("B. monthly must not cost dramatically more than weekly (cause 2: the loop)", () => {
  // nextOccurrence's day-frequency branch is already closed-form O(1); the
  // monthly branch loops from startDate on every call. Weekly is therefore
  // a known-good control for the identical query on the same machine in the
  // same run -- if monthly is far slower, the loop is the only difference.
  //
  // On main: monthly 122.8us, weekly 1.26us -- 97.8x.
  it.fails("monthly nextOccurrence is within 5x of weekly at the same item age (CURRENTLY ~98x)", () => {
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
  // NOTE, recorded as a prediction this test will check rather than assert:
  // fixing cause 1 alone should make this ratio WORSE in relative terms
  // even as both sides become fast, because 9 cycles x O(age) is still
  // O(age). Only the closed form flattens it.
  it.fails("a 1950-start item costs no more than 2x a 2026-start one (CURRENTLY ~3.3x)", () => {
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
  it.fails("capacityFreedFrom on a 20-year-old monthly item completes in under 50ms (CURRENTLY ~516ms)", () => {
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
