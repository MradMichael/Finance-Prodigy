import { projectCompletion } from "./projections";

/**
 * F3 — Goal Feasibility Engine, sub-phase 1: the pure allocation engine.
 * docs/ROADMAP.md, Phase 4, has the full design; the short version:
 *
 * Checking each goal against total capacity independently is exactly the
 * bug 2.4.44 already proved live on ProjectionsScreen's individual goal
 * rows -- three goals can each look individually affordable while their
 * SUM exceeds what's actually available. This engine never checks a goal
 * in isolation: it walks goals in priority order (soonest target date
 * first) and allocates capacity sequentially, the same shape
 * simulateDebtPayoff (debtEngine.ts) already uses for competing debts --
 * proven, not invented here.
 *
 * Currency-agnostic by design, mirroring DebtInput/toDebtInputs: amounts in
 * are already USD. The StoredGoal -> GoalCapacityInput conversion (currency
 * conversion, filtering out paused/archived goals) is a wiring-stage
 * concern, sub-phase 3, not this pure engine's job -- same division of
 * responsibility toDebtInputs already established for debts.
 */

export interface GoalCapacityInput {
  id: string;
  name: string;
  targetAmountUSD: number;
  currentAmountUSD: number;
  /** ISO date (YYYY-MM-DD). */
  targetDate: string;
}

export type GoalFeasibilityStatus = "achievable" | "achievable_with_adjustment" | "not_achievable";

export interface GoalAllocationResult {
  id: string;
  name: string;
  status: GoalFeasibilityStatus;
  remainingUSD: number;
  /** What this goal alone needs, ignoring every other goal, to hit its own target date. */
  requiredMonthlyRateUSD: number;
  /** What it actually gets once higher-priority goals have taken their share. */
  allocatedMonthlyRateUSD: number;
  /** Months to completion at the allocated rate; null if the allocated rate is 0 and there's still a gap (mirrors projectCompletion's own convention). */
  projectedMonths: number | null;
  projectedDateDisplay: string | null;
  /** Extra $/mo that would close the gap at this goal's CURRENT priority slot and restore its original target date. 0 when achievable. */
  shortfallMonthlyRateUSD: number;
}

export interface GoalCapacityConflict {
  /** True when the goals' combined requirement exceeds total capacity -- computed independently of any single goal's own status, from the same per-goal required rates the allocation walk below uses. Can never be true while every goal reads "achievable": there isn't enough capacity for that to be possible. */
  hasConflict: boolean;
  totalRequiredMonthlyRateUSD: number;
  totalCapacityUSD: number;
  /** totalRequired - totalCapacity, floored at 0. */
  shortfallUSD: number;
  /**
   * Approved in session 34 (owner, session 33): goals not yet met whose target date is before `asOf` (the date this
   * funding starts). No monthly amount meets them, so they're left out of totalRequired -- they used to
   * count their whole remainder as one month's need -- and named apart.
   */
  passedTargets: { id: string; name: string }[];
}

export interface GoalAllocationReport {
  conflict: GoalCapacityConflict;
  /** Priority order (soonest target date first) -- the order capacity was actually allocated in. */
  goals: GoalAllocationResult[];
}

/**
 * Months from `asOf` to `targetDate`, using the same 30.44-day-average
 * convention computeDashboard.ts's own goalPace already uses (rawMs there),
 * so this engine's requiredMonthlyRateUSD is comparable to what a user may
 * already have seen from that figure -- same math, correctly allocated
 * afterward instead of independently compared. Floored at 1 (never 0 or
 * negative) so an overdue or same-day target doesn't divide by zero or
 * flip sign; matches goalPace's own Math.max(1, rawMs).
 */
/**
 * A target date already behind `asOf` (the date this funding starts). One test for T4's per-goal status
 * and the combined figure's passed goals (session 33), so the two always agree on which goals have passed.
 */
function targetPassedBy(targetDate: string, asOf: Date): boolean {
  return new Date(targetDate).getTime() < asOf.getTime();
}

function monthsUntil(targetDate: string, asOf: Date): number {
  const rawMonths = Math.round((new Date(targetDate).getTime() - asOf.getTime()) / (30.44 * 24 * 3600 * 1000));
  return Math.max(1, rawMonths);
}

export function allocateGoalCapacity(
  goals: GoalCapacityInput[],
  monthlyCapacityUSD: number,
  asOf: Date,
): GoalAllocationReport {
  const withRates = goals.map((g) => {
    const remainingUSD = Math.max(0, g.targetAmountUSD - g.currentAmountUSD);
    const months = monthsUntil(g.targetDate, asOf);
    const requiredMonthlyRateUSD = remainingUSD / months;
    return { ...g, remainingUSD, months, requiredMonthlyRateUSD };
  });

  const passed = (g: (typeof withRates)[number]) => g.remainingUSD > 0 && targetPassedBy(g.targetDate, asOf);
  const totalRequiredMonthlyRateUSD = withRates.filter((g) => !passed(g)).reduce((s, g) => s + g.requiredMonthlyRateUSD, 0);
  const conflict: GoalCapacityConflict = {
    hasConflict: totalRequiredMonthlyRateUSD > monthlyCapacityUSD,
    totalRequiredMonthlyRateUSD,
    totalCapacityUSD: monthlyCapacityUSD,
    shortfallUSD: Math.max(0, totalRequiredMonthlyRateUSD - monthlyCapacityUSD),
    passedTargets: withRates.filter(passed).map((g) => ({ id: g.id, name: g.name })),
  };

  // Soonest target date first -- the same "quick wins / nearest deadline
  // first" instinct as debt snowball, and the sensible default absent any
  // user-chosen priority (a v2 concern, see the ROADMAP design note).
  const prioritized = [...withRates].sort((a, b) => new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime());

  let remainingCapacityUSD = monthlyCapacityUSD;
  const results: GoalAllocationResult[] = prioritized.map((g) => {
    const allocatedMonthlyRateUSD = g.remainingUSD <= 0
      ? 0
      : Math.max(0, Math.min(g.requiredMonthlyRateUSD, remainingCapacityUSD));
    remainingCapacityUSD = Math.max(0, remainingCapacityUSD - allocatedMonthlyRateUSD);

    const proj = projectCompletion(g.remainingUSD, allocatedMonthlyRateUSD, asOf);
    // T4 (session 32 review): a target already behind asOf (the date this funding starts -- for
    // Projections, after the safety net and debt) can't be met, whatever the rate. monthsUntil floors it
    // at 1 month, which read a goal landing a year late as "On track".
    const targetPassed = targetPassedBy(g.targetDate, asOf);
    const onSchedule = g.remainingUSD <= 0 || (!targetPassed && proj.months !== null && proj.months <= g.months);
    // "not_achievable" specifically means no reprioritization could ever
    // fix it -- this goal's own need exceeds the ENTIRE pool, not just
    // what was left after higher-priority goals. Anything short of that,
    // where the shortfall is purely a priority-order artifact, is
    // "achievable_with_adjustment": reprioritizing it higher, or adding
    // capacity, would close the gap.
    const status: GoalFeasibilityStatus = onSchedule
      ? "achievable"
      : g.requiredMonthlyRateUSD > monthlyCapacityUSD
      ? "not_achievable"
      : "achievable_with_adjustment";

    return {
      id: g.id,
      name: g.name,
      status,
      remainingUSD: g.remainingUSD,
      requiredMonthlyRateUSD: g.requiredMonthlyRateUSD,
      allocatedMonthlyRateUSD,
      projectedMonths: proj.months,
      projectedDateDisplay: proj.dateDisplay,
      shortfallMonthlyRateUSD: onSchedule ? 0 : g.requiredMonthlyRateUSD - allocatedMonthlyRateUSD,
    };
  });

  return { conflict, goals: results };
}

/**
 * Approved in session 34 (owner, session 33, P3-B: "keep -- freed money goes to goals by default, changeable"):
 * allocateGoalCapacity with a monthly capacity that can step up -- `capacityAt(m)` for month m from `asOf`
 * (an obligation ending). Each month, each goal (soonest target first) takes up to its required rate from
 * what higher-priority goals leave, a finished goal's share included: the closed form's rule applied month by
 * month, so a flat schedule gives allocateGoalCapacity's answer exactly. Status and the conflict use month 0's
 * capacity, as the closed form uses its one.
 */
export function allocateGoalCapacityScheduled(goals: GoalCapacityInput[], capacityAt: (month: number) => number, asOf: Date): GoalAllocationReport {
  const base = allocateGoalCapacity(goals, capacityAt(0), asOf);
  const HORIZON_MONTHS = 1200;
  const saved = base.goals.map(() => 0);
  const done: (number | null)[] = base.goals.map((r) => (r.remainingUSD <= 0 ? 0 : null));
  for (let m = 0; m < HORIZON_MONTHS && done.some((d) => d === null); m++) {
    let left = capacityAt(m);
    base.goals.forEach((r, i) => {
      const take = r.remainingUSD <= 0 ? 0 : Math.max(0, Math.min(r.requiredMonthlyRateUSD, left));
      left = Math.max(0, left - take);
      if (done[i] === null) { saved[i] += take; if (saved[i] >= r.remainingUSD - 1e-6) done[i] = m + 1; }
    });
  }
  const input = new Map(goals.map((g) => [g.id, g]));
  return {
    conflict: base.conflict,
    goals: base.goals.map((r, i) => {
      const months = done[i];
      // projectCompletion(months, 1) is `months` from asOf, dated the way every other row here is.
      const proj = months === null ? { months: null, dateDisplay: null } : projectCompletion(months, 1, asOf);
      const g = input.get(r.id)!;
      const targetPassed = new Date(g.targetDate).getTime() < asOf.getTime();
      const onSchedule = r.remainingUSD <= 0 || (!targetPassed && proj.months !== null && proj.months <= monthsUntil(g.targetDate, asOf));
      const status: GoalFeasibilityStatus = onSchedule ? "achievable" : r.requiredMonthlyRateUSD > capacityAt(0) ? "not_achievable" : "achievable_with_adjustment";
      return { ...r, status, projectedMonths: proj.months, projectedDateDisplay: proj.dateDisplay, shortfallMonthlyRateUSD: onSchedule ? 0 : r.requiredMonthlyRateUSD - r.allocatedMonthlyRateUSD };
    }),
  };
}

export interface GoalFastestResult {
  id: string;
  name: string;
  remainingUSD: number;
  /** Months until this goal completes under waterfall allocation; null when capacity is 0 and a gap remains (projectCompletion's own convention). */
  monthsToComplete: number | null;
  dateDisplay: string | null;
}

export interface GoalFastestReport {
  /** Priority order (soonest target date first) -- the same order allocateGoalCapacity walks, so the two views can be read side by side. */
  goals: GoalFastestResult[];
  /** Months until EVERY goal is complete. */
  allCompleteMonths: number | null;
  allCompleteDateDisplay: string | null;
}

/**
 * 2.4.68 -- "how fast could I finish", the question allocateGoalCapacity
 * deliberately does not answer.
 *
 * A SEPARATE engine, not a mode of allocateGoalCapacity. That one answers
 * "can I afford this by that date" and caps every goal at
 * requiredMonthlyRateUSD, derived from the goal's own targetDate, which is
 * exactly what makes its conflict banner and its achievable /
 * achievable_with_adjustment / not_achievable classification mean what they
 * say. The cap is correct there and is untouched by this function -- they
 * share only projectCompletion and the priority comparator, and
 * goalFeasibility.test.ts carries a guard asserting allocateGoalCapacity's
 * full output is unchanged.
 *
 * This engine has no notion of target dates at all. Waterfall allocation in
 * the same priority order: every available dollar goes to the frontmost
 * unfinished goal until it completes, then rolls to the next -- which is
 * why reordering goals visibly changes the intermediate dates. Because
 * capacity is never idle, goal i completes once the CUMULATIVE remaining
 * through i has been contributed, so each goal is just
 * projectCompletion(cumulative, capacity) rather than a month-by-month
 * simulation.
 *
 * Note that follows from the same fact and is asserted in the tests: the
 * all-complete date is ceil(totalRemaining / capacity) regardless of
 * ordering. Priority order moves which goal finishes first, never when
 * everything is done.
 */
export function fastestGoalCompletion(
  goals: GoalCapacityInput[],
  monthlyCapacityUSD: number,
  asOf: Date,
): GoalFastestReport {
  const prioritized = [...goals].sort((a, b) => new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime());

  let cumulativeUSD = 0;
  const results: GoalFastestResult[] = prioritized.map((g) => {
    const remainingUSD = Math.max(0, g.targetAmountUSD - g.currentAmountUSD);
    cumulativeUSD += remainingUSD;
    // An already-met goal is done now, not whenever the goals ahead of it
    // finish -- it adds nothing to the cumulative total, so it also never
    // pushes the goals behind it out.
    const proj = projectCompletion(remainingUSD <= 0 ? 0 : cumulativeUSD, monthlyCapacityUSD, asOf);
    return { id: g.id, name: g.name, remainingUSD, monthsToComplete: proj.months, dateDisplay: proj.dateDisplay };
  });

  const allComplete = projectCompletion(cumulativeUSD, monthlyCapacityUSD, asOf);
  return { goals: results, allCompleteMonths: allComplete.months, allCompleteDateDisplay: allComplete.dateDisplay };
}

/**
 * F3 sub-phase 2 -- capacity input, including the step-change. Path B
 * (owner's decision, docs/ROADMAP.md, Phase 3/4): computed internally from
 * StoredRecurring.endDate directly, rather than waiting on Phase 3's full
 * product surface (remaining-installments UI, a dedicated forward view) --
 * Phase 3 stays open with its own acceptance criteria, this is only the
 * slice of it F3 actually needs.
 *
 * baseCapacityUSD is assumed to already have every currently-active
 * obligation netted out (today's real, current monthly capacity) --
 * capacityByMonth adds each obligation's amount BACK once its own
 * freedFromDate passes, which is what produces the step change. Which
 * obligations are "currently active" (and thus already reflected in
 * baseCapacityUSD) is a wiring-stage decision (isRecurringActive), not this
 * pure function's -- same division of responsibility as
 * GoalCapacityInput/allocateGoalCapacity above.
 *
 * This function is bound-type-agnostic by design: it takes an already
 * resolved freedFromDate and never inspects endDate or totalAmount itself.
 * Resolving those is capacityFreedFrom's job (localData.ts), which keeps
 * this one pure and currency/storage-agnostic like its siblings above.
 */
export interface RecurringCapacityInput {
  id: string;
  monthlyAmountUSD: number;
  /**
   * ISO date (YYYY-MM-DD) from which this obligation stops consuming
   * capacity, or null for one that never does.
   *
   * Named for what it means rather than for where it came from, and
   * deliberately NOT `endDate`. That was the original field name, and it
   * caused the defect this replaces: callers built it from
   * `StoredRecurring.endDate` alone, so every `totalAmount`-capped item --
   * an instalment plan, a loan, the owner's own Uni item -- arrived here as
   * `null` and was treated as indefinite. A field called `endDate` invites
   * exactly that; one called `freedFromDate` has no obvious wrong thing to
   * pass. Build it with `capacityFreedFrom` (localData.ts), which resolves
   * both bound types and is where the one-cycle offset between them lives.
   */
  freedFromDate: string | null;
}

export interface MonthlyCapacity {
  monthsFromNow: number;
  capacityUSD: number;
}

/**
 * UTC-anchored month-stepper, deliberately not debtEngine.ts's own
 * addMonths (which uses local-time getters) -- endDate strings parse as
 * UTC midnight (this codebase's established convention, e.g. nextOccurrence/
 * dueCycles), and this function's exact-date comparisons need to stay on
 * the same basis regardless of which timezone this runs in, the same
 * reasoning isCycleOverdue's own UTC-anchored asOf already established.
 */
function addMonthsUTC(date: Date, months: number): Date {
  const targetDay = date.getUTCDate();
  const candidate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const daysInTargetMonth = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
  candidate.setUTCDate(Math.min(targetDay, daysInTargetMonth));
  return candidate;
}

export function capacityByMonth(
  baseCapacityUSD: number,
  obligations: RecurringCapacityInput[],
  monthsAhead: number,
  asOf: Date,
): MonthlyCapacity[] {
  const results: MonthlyCapacity[] = [];
  for (let m = 0; m <= monthsAhead; m++) {
    const monthDate = addMonthsUTC(asOf, m);
    const freedUpUSD = obligations
      .filter((o) => o.freedFromDate !== null && new Date(o.freedFromDate) <= monthDate)
      .reduce((s, o) => s + o.monthlyAmountUSD, 0);
    results.push({ monthsFromNow: m, capacityUSD: baseCapacityUSD + freedUpUSD });
  }
  return results;
}
