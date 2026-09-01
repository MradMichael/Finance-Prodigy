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
function monthsUntil(targetDate: string, asOf: Date): number {
  const rawMonths = Math.round((new Date(targetDate).getTime() - asOf.getTime()) / (30.44 * 24 * 3600 * 1000));
  return Math.max(1, rawMonths);
}

export function allocateGoalCapacity(
  goals: GoalCapacityInput[],
  monthlyCapacityUSD: number,
  asOf: Date = new Date(),
): GoalAllocationReport {
  const withRates = goals.map((g) => {
    const remainingUSD = Math.max(0, g.targetAmountUSD - g.currentAmountUSD);
    const months = monthsUntil(g.targetDate, asOf);
    const requiredMonthlyRateUSD = remainingUSD / months;
    return { ...g, remainingUSD, months, requiredMonthlyRateUSD };
  });

  const totalRequiredMonthlyRateUSD = withRates.reduce((s, g) => s + g.requiredMonthlyRateUSD, 0);
  const conflict: GoalCapacityConflict = {
    hasConflict: totalRequiredMonthlyRateUSD > monthlyCapacityUSD,
    totalRequiredMonthlyRateUSD,
    totalCapacityUSD: monthlyCapacityUSD,
    shortfallUSD: Math.max(0, totalRequiredMonthlyRateUSD - monthlyCapacityUSD),
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
    const onSchedule = g.remainingUSD <= 0 || (proj.months !== null && proj.months <= g.months);
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
 * F3 sub-phase 2 -- capacity input, including the step-change. Path B
 * (owner's decision, docs/ROADMAP.md, Phase 3/4): computed internally from
 * StoredRecurring.endDate directly, rather than waiting on Phase 3's full
 * product surface (remaining-installments UI, a dedicated forward view) --
 * Phase 3 stays open with its own acceptance criteria, this is only the
 * slice of it F3 actually needs.
 *
 * baseCapacityUSD is assumed to already have every currently-active
 * obligation netted out (today's real, current monthly capacity) --
 * capacityByMonth adds each obligation's amount BACK once its own endDate
 * passes, which is what produces the step change. Which obligations are
 * "currently active" (and thus already reflected in baseCapacityUSD) is a
 * wiring-stage decision (isRecurringActive), not this pure function's --
 * same division of responsibility as GoalCapacityInput/allocateGoalCapacity
 * above.
 */
export interface RecurringCapacityInput {
  id: string;
  monthlyAmountUSD: number;
  /** ISO date (YYYY-MM-DD), or null for an obligation with no end date -- never frees capacity. */
  endDate: string | null;
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
  asOf: Date = new Date(),
): MonthlyCapacity[] {
  const results: MonthlyCapacity[] = [];
  for (let m = 0; m <= monthsAhead; m++) {
    const monthDate = addMonthsUTC(asOf, m);
    const freedUpUSD = obligations
      .filter((o) => o.endDate !== null && new Date(o.endDate) <= monthDate)
      .reduce((s, o) => s + o.monthlyAmountUSD, 0);
    results.push({ monthsFromNow: m, capacityUSD: baseCapacityUSD + freedUpUSD });
  }
  return results;
}
