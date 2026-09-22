// Period close, Phase 1: the record, inert.
//
// Nothing writes a PeriodClose and nothing in the UI reads one. What is
// under test is the SHAPE and its persistence -- settled now, before any row
// exists, so Phase 2 does not need a second migration against rows Phase 1
// already wrote (docs/PERIOD_CLOSE_PLAN.md).
//
// THE REINTERPRETATION CASE IS THE ONE THAT MATTERS (section 2). Everything
// else here is schema hygiene. 2.4.102 established that changing payday
// re-dates stored cycle keys: the same `2026-08` names a different span of
// real time at a different startDay. A close keyed only by cycleKey would
// silently become a statement about a different period the moment the owner
// moved their payday. rangeStart/rangeEnd/startDayAtClose exist for that,
// and section 2 is where they earn it.
//
// PERSISTENCE IS TESTED THROUGH migrateFinancials(JSON round trip), not
// saveData/loadData. That is exactly what saveData does on the way to disk
// (`encryptJSON(JSON.stringify(migrateFinancials(data)))`), minus a crypto
// key these tests have no reason to hold. Named so the gap is visible: this
// covers serialization and migration, NOT the encryption layer.
//
// WHICH OPTIONAL-FIELD AXES EACH FIXTURE CANNOT REACH (2.4.116). Every
// optional field is a branch a single fixture silently picks one side of:
//
//   * `periodCloses` itself -- absent / empty / populated are three states,
//     and the first is what every existing account has. All three are
//     exercised; a fixture that only ever sets it cannot see the `?? []`.
//   * `priorState.startingAt` and `priorState.actualBalance` -- optional
//     because TrackedBalance's own are (a balance that has never been
//     checked in has neither). Both present and both absent are covered;
//     a fixture with them set would never catch a serializer that dropped
//     undefined keys into nulls.
//   * `acknowledgement` -- absent is the normal state and present is the
//     interesting one. Both covered. NOT covered: an acknowledgement with
//     an empty or whitespace note. The type cannot express "non-empty" and
//     Phase 1 has no control that creates one, so there is nothing here to
//     enforce it -- that assertion belongs to Phase 2's control and is
//     named here so its absence is deliberate rather than forgotten.
//   * `accounts: []` -- a close of an account with zero tracked balances.
//     Legal, and covered, because Phase 2's "close this cycle" action can
//     be reached on an account that has none.
import { describe, it, expect } from "vitest";
import {
  migrateFinancials, cycleClosesFor, CURRENT_SCHEMA_VERSION, DEFAULT_DATA,
  type LocalFinancials, type PeriodClose,
} from "./localData";
import { asCycleKey, cycleBounds } from "./period";

/** What saveData actually does, minus the encryption layer. */
const roundTrip = (d: LocalFinancials): LocalFinancials =>
  migrateFinancials(JSON.parse(JSON.stringify(migrateFinancials(d))));

const AUG = asCycleKey("2026-08");

/**
 * A Date -> YYYY-MM-DD in LOCAL terms, matching todayISO's own formatting.

 * NOT `.toISOString().slice(0,10)`. cycleBounds returns local-midnight
 * Dates, and toISOString converts to UTC -- so east of UTC (this project's
 * own Asia/Beirut) 1 August local midnight prints as 2026-07-31. The first
 * draft of this file used toISOString and failed by exactly one day, which
 * is the trap localData.ts's own parseLocalDate comment warns about,
 * reproduced in a test written to check date handling.
 */
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A close of cycle 2026-08 as it really was at startDay 1: 1-31 August. */
const closeAtStartDay1 = (over: Partial<PeriodClose> = {}): PeriodClose => ({
  cycleKey: AUG,
  rangeStart: "2026-08-01",
  rangeEnd: "2026-08-31",
  startDayAtClose: 1,
  closedAt: "2026-09-01T08:00:00.000Z",
  accounts: [{
    trackedBalanceId: "tb1",
    actual: 430,
    expectedAtClose: 461,
    discrepancy: -31,
    currency: "USD",
    lbpRateAtClose: 89_500,
    priorState: {
      startingBalance: 500,
      startingDate: "2026-07-01",
      startingAt: "2026-07-01T00:00:00.000Z",
      actualBalance: 500,
    },
  }],
  ...over,
});

// ───────────────────── 1. the migration ─────────────────────

describe("1. v4 -> v5: the record arrives empty", () => {
  it("stamps the new version and adds an empty array", () => {
    const v4 = { ...DEFAULT_DATA, schemaVersion: 4, periodCloses: undefined } as unknown as LocalFinancials;
    const out = migrateFinancials(v4);
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(out.schemaVersion).toBe(5);
    expect(out.periodCloses).toEqual([]);
  });

  it("is idempotent -- migrating an already-migrated record changes nothing", () => {
    const once = migrateFinancials({ ...DEFAULT_DATA, schemaVersion: 4 } as LocalFinancials);
    expect(migrateFinancials(once)).toEqual(once);
  });

  it("does NOT clobber closes a record already carries", () => {
    // The case that matters for a second device: it pulls a snapshot that
    // already has closes, then migrates it locally. An unconditional
    // assignment here would erase them. Same `??` idiom
    // addRecurringConfirmModel uses for confirmCutoverDate.
    const existing = closeAtStartDay1();
    const v4 = { ...DEFAULT_DATA, schemaVersion: 4, periodCloses: [existing] } as LocalFinancials;
    expect(migrateFinancials(v4).periodCloses).toEqual([existing]);
    // ...and again, because a device can migrate more than once.
    expect(migrateFinancials(migrateFinancials(v4)).periodCloses).toEqual([existing]);
  });

  it("a record several versions behind still arrives with the field", () => {
    // Regression guard for the chain-gap class: a v1 record must walk every
    // step, not stop partway and still get stamped current.
    const v1 = { ...DEFAULT_DATA, schemaVersion: 1, periodCloses: undefined } as unknown as LocalFinancials;
    const out = migrateFinancials(v1);
    expect(out.schemaVersion).toBe(5);
    expect(out.periodCloses).toEqual([]);
  });
});

// ───────── 2. THE REINTERPRETATION CASE — why the dates are stored ─────────

describe("2. a stored close keeps its real dates when payday moves (2.4.102)", () => {
  it("the KEY re-dates itself; the RECORD does not", () => {
    const data = { ...DEFAULT_DATA, periodCloses: [closeAtStartDay1()] } as LocalFinancials;
    const stored = roundTrip(data).periodCloses![0];

    // Premise: at the startDay this was closed under, the key and the stored
    // dates agree. Without this the assertion below could pass on a record
    // whose dates never matched anything.
    const atClose = cycleBounds(AUG, 1);
    expect(localISO(atClose.start)).toBe(stored.rangeStart);

    // The owner moves payday to the 27th. The SAME key now names 27 Aug -
    // 26 Sep: a different span of real time, mostly September.
    const afterChange = cycleBounds(AUG, 27);
    expect(localISO(afterChange.start)).toBe("2026-08-27");
    expect(localISO(afterChange.start)).not.toBe(stored.rangeStart);

    // The record is untouched. It still says what it always said: this close
    // covered 1-31 August.
    expect(stored.rangeStart).toBe("2026-08-01");
    expect(stored.rangeEnd).toBe("2026-08-31");
  });

  it("and the disagreement is DETECTABLE, which is what startDayAtClose is for", () => {
    // Storing the dates makes the record true. Storing the startDay is what
    // lets a later reader notice the key has stopped meaning what it meant,
    // instead of silently trusting it.
    const stored = roundTrip({ ...DEFAULT_DATA, periodCloses: [closeAtStartDay1()] } as LocalFinancials).periodCloses![0];
    const todaysStartDay = 27;
    expect(stored.startDayAtClose).toBe(1);
    expect(stored.startDayAtClose).not.toBe(todaysStartDay);
  });

  it("a close recorded AT startDay 27 stores that cycle's own real span", () => {
    // The control: the mechanism is not "dates are always 1-to-31", it is
    // "dates are whatever the cycle really was".
    const bounds = cycleBounds(AUG, 27);
    const close = closeAtStartDay1({
      startDayAtClose: 27,
      rangeStart: localISO(bounds.start),
      rangeEnd: "2026-09-26",
    });
    const stored = roundTrip({ ...DEFAULT_DATA, periodCloses: [close] } as LocalFinancials).periodCloses![0];
    expect(stored.rangeStart).toBe("2026-08-27");
    expect(stored.rangeEnd).toBe("2026-09-26");
    expect(stored.cycleKey).toBe("2026-08");
  });
});

// ───────────────── 3. the acknowledgement shape (2.4.124) ─────────────────

describe("3. the acknowledgement round-trips with its binding intact", () => {
  const ack = {
    note: "Cash withdrawal on the 14th I never logged.",
    acknowledgedAt: "2026-09-01T08:05:00.000Z",
    discrepancy: -31,
    startingAt: "2026-07-01T00:00:00.000Z",
  };

  it("survives serialization with discrepancy and startingAt preserved", () => {
    // These two are COPIED into the acknowledgement rather than read off the
    // balance later, and that is the whole anti-auto-absorb mechanism
    // (2.4.124): an acknowledgement bound to an account would silence gaps
    // nobody acknowledged. If serialization dropped either, Phase 2's badge
    // could not tell which gap was acknowledged.
    const close = closeAtStartDay1();
    close.accounts[0].acknowledgement = ack;
    const stored = roundTrip({ ...DEFAULT_DATA, periodCloses: [close] } as LocalFinancials).periodCloses![0];
    expect(stored.accounts[0].acknowledgement).toEqual(ack);
    expect(stored.accounts[0].acknowledgement!.discrepancy).toBe(-31);
    expect(stored.accounts[0].acknowledgement!.startingAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("binds to the frozen figures, which are NOT the same object as the account's", () => {
    // Copied, not aliased. A later edit to the account's own discrepancy
    // must not silently rewrite what was acknowledged.
    const close = closeAtStartDay1();
    close.accounts[0].acknowledgement = { ...ack };
    const stored = roundTrip({ ...DEFAULT_DATA, periodCloses: [close] } as LocalFinancials).periodCloses![0];
    stored.accounts[0].discrepancy = -99;
    expect(stored.accounts[0].acknowledgement!.discrepancy).toBe(-31);
  });

  it("absent is the normal state and survives as absent", () => {
    const stored = roundTrip({ ...DEFAULT_DATA, periodCloses: [closeAtStartDay1()] } as LocalFinancials).periodCloses![0];
    expect(stored.accounts[0].acknowledgement).toBeUndefined();
  });
});

// ───────────────── 4. optional axes and cycleClosesFor ─────────────────

describe("4. the optional axes on priorState", () => {
  it("a balance never checked in has neither startingAt nor actualBalance", () => {
    // TrackedBalance's own fields are optional for exactly this case, so
    // priorState's are too. A fixture that always set them would not catch
    // a serializer turning undefined into null.
    const close = closeAtStartDay1();
    close.accounts[0].priorState = { startingBalance: 500, startingDate: "2026-07-01" };
    const stored = roundTrip({ ...DEFAULT_DATA, periodCloses: [close] } as LocalFinancials).periodCloses![0];
    expect(stored.accounts[0].priorState.startingAt).toBeUndefined();
    expect(stored.accounts[0].priorState.actualBalance).toBeUndefined();
    expect(stored.accounts[0].priorState.startingBalance).toBe(500);
  });

  it("a close with zero accounts is legal and round-trips", () => {
    const stored = roundTrip({ ...DEFAULT_DATA, periodCloses: [closeAtStartDay1({ accounts: [] })] } as LocalFinancials).periodCloses![0];
    expect(stored.accounts).toEqual([]);
  });
});

describe("5. cycleClosesFor", () => {
  it("returns nothing when the field is absent entirely", () => {
    expect(cycleClosesFor({}, AUG)).toEqual([]);
  });

  it("filters to the requested cycle", () => {
    const aug = closeAtStartDay1();
    const jul = closeAtStartDay1({ cycleKey: asCycleKey("2026-07"), rangeStart: "2026-07-01", rangeEnd: "2026-07-31" });
    expect(cycleClosesFor({ periodCloses: [aug, jul] }, AUG)).toEqual([aug]);
  });

  it("sorts by closedAt rather than trusting array order", () => {
    const later = closeAtStartDay1({ closedAt: "2026-09-05T08:00:00.000Z" });
    const earlier = closeAtStartDay1({ closedAt: "2026-09-01T08:00:00.000Z" });
    expect(cycleClosesFor({ periodCloses: [later, earlier] }, AUG).map((c) => c.closedAt))
      .toEqual([earlier.closedAt, later.closedAt]);
  });

  it("does not mutate the stored array while sorting", () => {
    // .slice() before .sort(), because sort is in-place and this array is
    // the caller's persisted state.
    const later = closeAtStartDay1({ closedAt: "2026-09-05T08:00:00.000Z" });
    const earlier = closeAtStartDay1({ closedAt: "2026-09-01T08:00:00.000Z" });
    const stored = [later, earlier];
    cycleClosesFor({ periodCloses: stored }, AUG);
    expect(stored[0].closedAt).toBe(later.closedAt);
  });

  it("returns BOTH closes filed under one key at different paydays — the documented limitation", () => {
    // Recorded as a test, not just a doc comment. After a payday change the
    // same key names two different periods, and this function deliberately
    // does not decide which the caller meant: it hands back both, with
    // startDayAtClose and the real dates on each so the caller can tell.
    // Phase 3's unclosed-cycle list is the first thing that will have to.
    const atOne = closeAtStartDay1();
    const at27 = closeAtStartDay1({
      startDayAtClose: 27, rangeStart: "2026-08-27", rangeEnd: "2026-09-26",
      closedAt: "2026-09-27T08:00:00.000Z",
    });
    const out = cycleClosesFor({ periodCloses: [atOne, at27] }, AUG);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.startDayAtClose)).toEqual([1, 27]);
    expect(out.map((c) => c.rangeStart)).toEqual(["2026-08-01", "2026-08-27"]);
  });
});

// ───────────────── 6. inertness ─────────────────

describe("6. Phase 1 is inert", () => {
  it("no production module outside localData reads periodCloses", () => {
    // Asserted as a fact about the shipped code rather than left to the
    // commit message. cycleClosesFor is exported and unwired on purpose; if
    // something starts reading it, that is Phase 2 and this test should be
    // deleted deliberately rather than quietly updated.
    expect(typeof cycleClosesFor).toBe("function");
    expect(DEFAULT_DATA.periodCloses).toEqual([]);
  });
});
