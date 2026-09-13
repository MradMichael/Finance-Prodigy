"use client";

import { useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { BUDGET_RULES, moneyEquals, capacityFreedFrom, isRecurringActive, toUSD as toUSDShared, DEFAULT_LBP_RATE } from "../../lib/localData";
import { dateFmt, toDebtInputs, type computeDashboard } from "../../lib/computeDashboard";
import { simulateDebtPayoff, addMonths, type DebtInput } from "../../lib/debtEngine";
import { projectCompletion } from "../../lib/projections";
import { allocateGoalCapacity, fastestGoalCompletion, capacityByMonth, type GoalCapacityInput, type GoalAllocationReport, type GoalFastestReport, type GoalFeasibilityStatus, type RecurringCapacityInput } from "../../lib/goalFeasibility";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, NUMS, money } from "./shared";

type PriorityKey = "ef" | "debt" | "goals";
const PRIORITY_META: Record<PriorityKey, { label: string; color: (T: ReturnType<typeof useTheme>) => string }> = {
  ef:    { label: "Safety net", color: (T) => T.jade },
  debt:  { label: "Debt",           color: (T) => T.coral },
  goals: { label: "Goals",          color: (T) => T.brass },
};

interface StageResult { months: number | null; startMonths: number; dateDisplay: string | null; warning?: string | null; skipped?: boolean }

/** F3 (Goal Feasibility Engine) status -> label/color, the per-goal breakdown's own equivalent of PRIORITY_META above. */
const GOAL_STATUS_META: Record<GoalFeasibilityStatus, { label: string; color: (T: ReturnType<typeof useTheme>) => string }> = {
  achievable:                 { label: "On track",                        color: (T) => T.jade },
  achievable_with_adjustment: { label: "Needs adjustment",                 color: (T) => T.brass },
  not_achievable:              { label: "Not achievable at this amount",   color: (T) => T.coral },
};

function Bar({ pct, color, T }: { pct: number; color: string; T: ReturnType<typeof useTheme> }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: T.line }}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color, transition: "width 0.8s ease" }} />
    </div>
  );
}

/** "3 mo, by 14-09-2028" / "not at this rate" — the shared readout used by the current-pace-vs-plan cards below. */
function PaceRow({ label, months, dateDisplay, color, T }: { label: string; months: number | null; dateDisplay: string | null; color: string; T: ReturnType<typeof useTheme> }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>{label}</p>
      {months === null ? (
        <p className="text-sm mt-0.5" style={{ color: T.coral }}>Not at this rate</p>
      ) : months === 0 ? (
        <p className="text-lg font-medium mt-0.5" style={{ ...SERIF, color: T.jade }}>Already there</p>
      ) : (
        <>
          <p className="text-lg font-medium tabular-nums mt-0.5" style={{ ...SERIF, color }}>{dateDisplay}</p>
          <p className="text-xs" style={{ color: T.mute }}>{months} month{months === 1 ? "" : "s"} away</p>
        </>
      )}
    </div>
  );
}

export default function ProjectionsScreen({
  financials, dashData,
}: {
  financials: LocalFinancials;
  dashData: ReturnType<typeof computeDashboard>;
}) {
  const T = useTheme();
  const { emergencyFund, debt, goals, budgetTargets, budgetTargetPct, budgetRule, month, anchor } = dashData;

  const hasIncome = month.income > 0;
  const efRemaining = Math.max(0, emergencyFund.remaining);
  // 2.4.81: one call, one anchor. This was two identical inline
  // projectCompletion calls on the same JSX line -- one for .months, one for
  // .dateDisplay -- each evaluating its own defaulted `new Date()`, so in
  // principle the two halves of a single readout could straddle midnight and
  // disagree. It is also the LEFT column of a grid-cols-2 whose right column
  // comes from the cascade, which is the pair 2.4.81 is about: both now read
  // the same anchor, and naming the value gives the screen's own tests
  // something to assert against (2.4.82).
  const efRecommendedPace = projectCompletion(efRemaining, budgetTargets.savings, anchor);
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const liveDebts: DebtInput[] = toDebtInputs(financials.debts, lbpRate, financials.transactions);

  // ── Looking ahead: bounded obligations that free capacity later ──
  //
  // F2's forward-capacity half (docs/ROADMAP.md, Phase 3). capacityByMonth
  // has existed and been tested since 2026-09-01 but was called from
  // nowhere; this is its first consumer.
  //
  // baseCapacityUSD is deliberately 0. The obvious-looking alternative --
  // passing testAmount so the strip could say "you could plan with $842"
  // -- is a category error: testAmount is a DIALED planning amount seeded
  // from budgetTargets.savings (a percentage of income), while freed
  // capacity is money that stops leaving the account. Income doesn't
  // change when an instalment plan ends, so budgetTargets.savings doesn't
  // either, and adding the two would produce a figure with no defined
  // meaning. At base 0 the series IS the freed amount, and the strip can
  // only ever report what it actually knows.
  //
  // Only currently-active obligations are considered: one that has already
  // ended isn't a future step, its capacity is already in hand, and
  // capacityFreedFrom would credit it from month 0 and read as a promise
  // of money the user already has.
  const CAPACITY_HORIZON_MONTHS = 36;
  // 2.4.81: the shared anchor, not a local new Date().
  const capacityNow = anchor;
  // Same UTC month-stepping capacityByMonth uses internally, so "inside the
  // horizon" here and "counted in the series" there can't disagree.
  const capacityHorizonEnd = new Date(Date.UTC(
    capacityNow.getUTCFullYear(), capacityNow.getUTCMonth() + CAPACITY_HORIZON_MONTHS, capacityNow.getUTCDate(),
  ));

  const boundedObligations = (financials.recurring ?? [])
    .filter((r) => isRecurringActive(r, capacityNow))
    .map((r) => ({
      r,
      freed: capacityFreedFrom(r, financials.transactions, capacityNow),
      monthlyAmountUSD: toUSDShared(r.amount, r.currency, lbpRate),
    }))
    .filter((o): o is typeof o & { freed: Date } => o.freed !== null)
    .sort((a, b) => a.freed.getTime() - b.freed.getTime());

  const capacitySeries = capacityByMonth(
    0,
    boundedObligations.map<RecurringCapacityInput>((o) => ({
      id: o.r.id,
      monthlyAmountUSD: o.monthlyAmountUSD,
      freedFromDate: o.freed.toISOString().slice(0, 10),
    })),
    CAPACITY_HORIZON_MONTHS,
    capacityNow,
  );
  // An obligation freeing up beyond the horizon is real but too far out to
  // be worth a row. Counted rather than silently dropped -- a strip that
  // quietly omits one reads as "this is all of them".
  const capacitySteps = boundedObligations.filter((o) => o.freed <= capacityHorizonEnd);
  const capacityStepsBeyondHorizon = boundedObligations.length - capacitySteps.length;
  const totalFreedInHorizon = capacitySeries[CAPACITY_HORIZON_MONTHS].capacityUSD;
  const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  const openGoals = goals.filter((g) => g.projection.pctComplete < 100 && !g.paused);
  const totalGoalsRemaining = openGoals.reduce((s, g) => {
    const remaining = Math.max(0, g.targetAmount - g.currentAmount);
    return s + toUSDShared(remaining, g.currency, lbpRate);
  }, 0);

  // F3 (Goal Feasibility Engine), sub-phase 3: dashData.goals[].id is a
  // 1-based array INDEX into financials.goals, not a real StoredGoal.id
  // (2.4.49) -- allocateGoalCapacity's results are keyed by real id, so the
  // mapping below zips financials.goals with dashData.goals BY ARRAY INDEX
  // (both are built from the same data.goals.map(), same order, same
  // length -- the same guarantee GoalsScreen.tsx's editGoal/pay/togglePause
  // already rely on), carrying the real id through instead of the display
  // index.
  const openGoalsWithId = financials.goals
    .map((stored, i) => ({ stored, dash: goals[i] }))
    .filter(({ dash }) => dash.projection.pctComplete < 100 && !dash.paused);
  const goalCapacityInputs: GoalCapacityInput[] = openGoalsWithId.map(({ stored }) => ({
    id: stored.id,
    name: stored.name,
    targetAmountUSD: toUSDShared(stored.targetAmount, stored.currency, lbpRate),
    currentAmountUSD: toUSDShared(stored.currentAmount, stored.currency, lbpRate),
    targetDate: stored.targetDate,
  }));

  // The one number that drives every projection below — directly set, not a
  // hidden sum of "recommended savings + something else" (that combination
  // read as a bug the first time it shipped: dial the slider to $150 and
  // the plan quietly used $425). Starts at the recommended savings figure
  // since that's a real, explained number, not zero.
  const [testAmount, setTestAmount] = useState(() => Math.max(0, Math.round(budgetTargets.savings)));
  const surplus = Math.max(0, Math.round(month.netCashFlow));
  // The number input had no upper bound at all, so a mis-typed or
  // exploratory entry (e.g. an extra digit or two) could land on something
  // like $789,200,024/mo with nothing to catch it. A flat $1,000,000 cap
  // caught that, but is meaningless as a guard for an account with a real
  // income nowhere near that scale -- 2.4.43: income-relative instead,
  // floored so a very small income doesn't produce a degenerately tight
  // cap. Falls back to the old flat figure only when no income is set yet
  // at all (a fresh account, before Setup) -- income * 3 would be $0 there,
  // which would block every test amount outright.
  //
  // Declared BEFORE sliderMax: that bound is now clamped by this one, so
  // the order is load-bearing, not stylistic.
  const MAX_TEST_AMOUNT = hasIncome ? Math.max(3000, Math.round(month.income * 3)) : 1_000_000;
  // Spans income, and deliberately NOT derived from testAmount or surplus.
  //
  // testAmount (the original formula, Math.max(200, testAmount * 2,
  // surplus * 2)) made the track's own bound a function of the value the
  // track sets: every drag to the right edge roughly doubled the ceiling
  // for the next drag, so it escaped MAX_TEST_AMOUNT after about three
  // drags and grew without limit (2.4.75).
  //
  // surplus (the first fix) removed that, but tied the track to whatever
  // happened to be left over this month -- at a surplus of $145 the whole
  // track spanned $290, against a meaningful range running to the cap, and
  // the cap never bound at all. Income is the stable figure the plan is
  // actually about, so the track spans that: wide enough to be worth
  // dragging, still fixed, still inside the cap.
  //
  // Floored at 200 so a zero/unset income (before Setup) doesn't produce a
  // zero-length track; MAX_TEST_AMOUNT keeps its own separate no-income
  // fallback, so the two diverge in that one case by design.
  const sliderMax = Math.min(MAX_TEST_AMOUNT, Math.max(200, month.income));

  // What order the plan tackles things in — user-controlled, not hardcoded.
  // A dollar can only be spent once: this is what makes the plan below a
  // single realistic sequence instead of the same amount tested against
  // each goal independently (which is what shipped before this and was
  // confusing: "I can't put $150 toward three different things at once").
  // 2.4.68: opt-in, default off. The plan is what this screen is for; the
  // fastest view answers a different question ("how fast could I finish if
  // everything went to goals in order") and showing both dates permanently
  // is the specific misread this toggle exists to avoid.
  const [showFastest, setShowFastest] = useState(false);
  const [priority, setPriority] = useState<PriorityKey[]>(["ef", "debt", "goals"]);
  function movePriority(index: number, dir: -1 | 1) {
    setPriority((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // ── The plan: walk `priority` in order, each stage starting only once ──
  // the one before it finishes, all drawing on the same testAmount/mo.
  const stages: Record<PriorityKey, StageResult> = {
    ef:    { months: null, startMonths: 0, dateDisplay: null },
    debt:  { months: null, startMonths: 0, dateDisplay: null },
    goals: { months: null, startMonths: 0, dateDisplay: null },
  };
  let cursor = 0;
  let feasible = hasIncome && testAmount > 0;
  let stopReason: string | null = null;
  // F3 sub-phase 3: set only when the plan's priority order actually
  // reaches the goals stage (mirrors stages.goals itself) -- computed at
  // the SAME asOf (startDate, i.e. cursor months from now) the sequential
  // plan below uses, not "today", so the conflict banner and the overall
  // plan timeline can never disagree about when goals actually start
  // competing for capacity.
  let goalAllocationReport: GoalAllocationReport | null = null;
  // The asOf the goals stage actually starts at (cursor months from now,
  // after EF/debt). Captured so the opt-in fastest view below can be
  // computed at the SAME moment the plan's own goal dates are -- otherwise
  // the two columns would silently be anchored to different start dates and
  // the comparison between them would be meaningless.
  let goalsStageStartDate: Date | null = null;
  for (const key of priority) {
    if (!feasible) { stages[key] = { months: null, startMonths: cursor, dateDisplay: null, skipped: true }; continue; }
    const startDate = addMonths(anchor, cursor);
    if (key === "ef") {
      const proj = projectCompletion(efRemaining, testAmount, startDate);
      stages.ef = { months: proj.months, startMonths: cursor, dateDisplay: proj.dateDisplay };
      if (proj.months === null) { feasible = false; stopReason = "Not reachable at this monthly amount."; } else cursor += proj.months;
    } else if (key === "debt") {
      if (liveDebts.length === 0) {
        stages.debt = { months: 0, startMonths: cursor, dateDisplay: dateFmt(startDate) };
      } else {
        const plan = simulateDebtPayoff(liveDebts, testAmount, "AVALANCHE", startDate);
        if (plan.feasible) {
          stages.debt = { months: plan.months, startMonths: cursor, dateDisplay: plan.debtFreeDate ? dateFmt(new Date(plan.debtFreeDate)) : null };
          cursor += plan.months;
        } else {
          stages.debt = { months: null, startMonths: cursor, dateDisplay: null, warning: plan.warning };
          feasible = false; stopReason = plan.warning ?? "Debt isn't reachable at this monthly amount.";
        }
      }
    } else {
      // Sequential priority allocation (allocateGoalCapacity), not the old
      // single-pool projectCompletion(totalGoalsRemaining, ...) -- that
      // treated every open goal as one blended blob with no awareness of
      // any individual goal's own target date or of competition between
      // goals, exactly the bug 2.4.44 already proved live on this screen's
      // own per-goal rows. testAmount is the right capacity figure here
      // (not a reduced share of it): this branch only ever runs once EF and
      // Debt have already finished (the !feasible guard above), so by
      // definition the FULL testAmount/mo is free for goals at this point
      // -- the same assumption the old single-pool call already made.
      const report = allocateGoalCapacity(goalCapacityInputs, testAmount, startDate);
      goalAllocationReport = report;
      goalsStageStartDate = startDate;
      if (report.goals.length === 0) {
        stages.goals = { months: 0, startMonths: cursor, dateDisplay: dateFmt(startDate) };
      } else if (report.goals.some((g) => g.projectedMonths === null)) {
        // At least one goal was allocated $0/mo and still has a gap -- no
        // finite date exists for it at this rate (projectCompletion's own
        // convention), so the combined goals stage itself has no finite date.
        stages.goals = { months: null, startMonths: cursor, dateDisplay: null };
        feasible = false;
        stopReason = report.conflict.hasConflict
          ? `Goals need ${money(report.conflict.shortfallUSD)}/mo more than this plan provides to hit every target date.`
          : "Goals aren't reachable at this monthly amount.";
      } else {
        // The stage isn't "done" until every open goal is -- the furthest
        // one out determines the combined finish. Reuses that goal's own
        // projectedDateDisplay (computed by allocateGoalCapacity at this
        // same startDate) rather than re-deriving a date from the month
        // count, so this can never drift from the per-goal row below it.
        const last = report.goals.reduce((a, b) => (b.projectedMonths ?? 0) > (a.projectedMonths ?? 0) ? b : a);
        stages.goals = { months: last.projectedMonths, startMonths: cursor, dateDisplay: last.projectedDateDisplay };
        cursor += last.projectedMonths ?? 0;
      }
    }
  }
  // Computed only when asked for, and only once the plan actually reaches
  // the goals stage -- same guard the per-goal rows below already use, so
  // the toggle can never surface dates for a stage the plan never got to.
  const fastestReport: GoalFastestReport | null =
    showFastest && goalAllocationReport !== null && goalsStageStartDate !== null
      ? fastestGoalCompletion(goalCapacityInputs, testAmount, goalsStageStartDate)
      : null;

  const totalMonths = feasible ? cursor : null;
  const stabilityDateDisplay = totalMonths !== null ? dateFmt(addMonths(anchor, totalMonths)) : null;

  // Straight sum of what's actually still owed/short right now, independent
  // of the plan above: EF's remaining gap + total debt balance + every open
  // goal's remaining amount. What it would take, today, in one lump sum.
  const totalNeededNow = efRemaining + debt.totalBalance + totalGoalsRemaining;
  const planTotal = efRemaining + debt.totalBalance + totalGoalsRemaining || 1;
  const efShare = liveDebts.length + openGoals.length + (efRemaining > 0 ? 1 : 0) > 0 ? efRemaining / planTotal : 0;

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">

        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Projections</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>
            One realistic plan for your safety net, debt, and goals, in whatever order you prioritize them.
          </p>
        </div>

        {/* Total needed now */}
        {totalNeededNow > 0 && (
          <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: T.mute }}>Total needed right now, in one lump sum</p>
            <p className="text-3xl" style={{ ...SERIF, ...NUMS, color: T.brass }}>{money(totalNeededNow)}</p>
            <p className="text-[11px] mt-1" style={{ color: T.mute }}>
              {money(efRemaining)} to finish the safety net + {money(debt.totalBalance)} of debt + {money(totalGoalsRemaining)} across open goals.
            </p>
          </div>
        )}

        {/* Recommended savings */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          {/* 2.4.70: budgetTargets (income * pct for the month), matching the
              Budget screen and Overview's Budget card. This headline and the
              three sites tied to it by the word "recommended" -- the plan
              amount it seeds, the "Recommended savings" preset, and the "At
              recommended pace" EF projection -- all read the same figure, or
              the screen would show two different numbers under one word.
              budgetPace and its alerts still use the rollover-adjusted
              target; that is deliberate and unrelated to this display. */}
          <p className="text-xs uppercase tracking-widest mb-2" style={{ color: T.mute }}>Recommended monthly savings</p>
          {hasIncome ? (
            <>
              <p className="text-4xl" style={{ ...SERIF, ...NUMS, color: T.jade }}>{money(budgetTargets.savings)}<span className="text-base" style={{ color: T.mute }}>/mo</span></p>
              <p className="text-xs mt-2" style={{ color: T.mute }}>
                {budgetTargetPct.savings}% of income under your {BUDGET_RULES[budgetRule].label} rule.
              </p>
            </>
          ) : (
            <p className="text-sm" style={{ color: T.mute }}>Set your monthly income in My Finances to see a recommended figure here.</p>
          )}
        </div>

        {/* Monthly amount + priority order */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Monthly amount to plan with</p>
              <div className="flex items-center gap-1.5">
                <span style={{ color: T.brass }}>$</span>
                <input
                  type="number" min={0} max={MAX_TEST_AMOUNT} step={10}
                  value={testAmount}
                  onChange={(e) => setTestAmount(Math.min(MAX_TEST_AMOUNT, Math.max(0, Math.round(Number(e.target.value) || 0))))}
                  className="w-24 rounded-lg px-2 py-1 text-sm font-semibold tabular-nums text-right"
                  style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.brass }}
                  aria-label="Monthly amount to plan with"
                />
              </div>
            </div>
            <input
              type="range" min={0} max={sliderMax} step={10}
              value={Math.min(testAmount, sliderMax)}
              // Drag interactions on some browsers/touch devices can report
              // a fractional intermediate value before snapping to `step`
              // -- round the same way the paired number input already does
              // so a drag can't leave testAmount at something like
              // $6.8909608.
              //
              // The Math.min(MAX_TEST_AMOUNT, ...) is the clamp the paired
              // number input always had and this one never did. Both write
              // the same state, so a bound enforced on only one of them is
              // not enforced at all -- the element's own `max` is the track
              // length, not the cap, and cannot be relied on for a value
              // that arrives by keyboard, touch, or assistive input.
              onChange={(e) => setTestAmount(Math.min(MAX_TEST_AMOUNT, Math.max(0, Math.round(Number(e.target.value) / 10) * 10)))}
              className="w-full"
              style={{ accentColor: T.brass }}
              aria-label="Monthly amount to plan with (slider)"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                { label: "Recommended savings", v: Math.round(budgetTargets.savings) },
                { label: `My full surplus (${money(surplus)})`, v: surplus },
              ].map((p) => {
                // moneyEquals, not === -- p.v for the surplus preset is
                // itself computed (income minus commitments), so a re-render
                // after any unrelated financials edit can recompute it to a
                // float a hair off from what testAmount was actually set to
                // at click-time, silently dropping the "active" highlight.
                const active = moneyEquals(testAmount, p.v);
                return (
                  <button
                    key={p.label}
                    onClick={() => setTestAmount(p.v)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                    style={{
                      background: active ? T.brass + "22" : T.panelSoft,
                      border: `1px solid ${active ? T.brass : T.line}`,
                      color: active ? T.brass : T.mute,
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: T.mute }}>Priority order</p>
            <div className="space-y-1.5">
              {priority.map((key, i) => (
                <div key={key} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: T.panelSoft }}>
                  <span className="text-xs font-semibold w-4" style={{ color: T.mute }}>{i + 1}</span>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PRIORITY_META[key].color(T) }} />
                  <span className="text-sm flex-1" style={{ color: T.text }}>{PRIORITY_META[key].label}</span>
                  <button onClick={() => movePriority(i, -1)} disabled={i === 0} aria-label={`Move ${PRIORITY_META[key].label} up in priority`} className="text-xs px-2 py-1 rounded-lg disabled:opacity-30 hover:opacity-70 transition-opacity" style={{ color: T.mute }}>↑</button>
                  <button onClick={() => movePriority(i, 1)} disabled={i === priority.length - 1} aria-label={`Move ${PRIORITY_META[key].label} down in priority`} className="text-xs px-2 py-1 rounded-lg disabled:opacity-30 hover:opacity-70 transition-opacity" style={{ color: T.mute }}>↓</button>
                </div>
              ))}
            </div>
            <p className="text-[10px] mt-2" style={{ color: T.mute }}>
              Every dollar of the amount above goes to whichever is first, in full, until it&apos;s done, then moves to the next.
            </p>
          </div>
        </div>

        {/* ── Looking ahead: bounded obligations freeing capacity later ──

            Sits BELOW the amount control and ABOVE the plan, and every
            line of copy here is deliberately about the future rather than
            about the plan underneath it.

            The plan is computed on one flat monthly amount for every
            month; it does not consume this. Saying "your goals will
            arrive sooner" -- or even phrasing this as capacity the plan
            has -- would be a claim the dates below don't support, and two
            figures on one screen that don't reconcile is exactly the
            failure this project has already logged once. So: state what
            frees up and when, say plainly that the plan doesn't count it,
            and stop there. Making the plan actually spend it is a separate,
            much larger change (approach B) and an open product decision. */}
        {capacitySteps.length > 0 && (
          <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: T.mute }}>Looking ahead</p>
            <div className="space-y-1.5">
              {capacitySteps.map((o) => (
                <div key={o.r.id} className="flex items-center justify-between gap-3 text-sm">
                  <span style={{ color: T.text }}>
                    {o.r.emoji ? `${o.r.emoji} ` : ""}{o.r.name} finishes
                  </span>
                  <span className="tabular-nums flex-shrink-0" style={{ color: T.jade }}>
                    +{money(o.monthlyAmountUSD)}/mo from {monthYear(o.freed)}
                  </span>
                </div>
              ))}
            </div>
            {capacitySteps.length > 1 && (
              <p className="text-xs mt-2 pt-2 tabular-nums" style={{ color: T.mute, borderTop: `1px solid ${T.line}` }}>
                {money(totalFreedInHorizon)}/mo in total, once all of them have.
              </p>
            )}
            {capacityStepsBeyondHorizon > 0 && (
              <p className="text-[11px] mt-2" style={{ color: T.mute }}>
                {capacityStepsBeyondHorizon === 1 ? "One more finishes" : `${capacityStepsBeyondHorizon} more finish`} beyond {CAPACITY_HORIZON_MONTHS / 12} years and {capacityStepsBeyondHorizon === 1 ? "isn't" : "aren't"} shown.
              </p>
            )}
            <p className="text-[11px] mt-3 pt-3" style={{ color: T.mute, borderTop: `1px solid ${T.line}` }}>
              This is what changes in your commitments, not in the plan below — that uses the single monthly amount you set above for every month, including these. Nothing below has been brought forward to account for it.
            </p>
          </div>
        )}

        {/* The plan */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.brass}50` }}>
          <p className="text-xs uppercase tracking-widest mb-2" style={{ color: T.brass }}>Your plan</p>
          {!hasIncome ? (
            <p className="text-sm" style={{ color: T.mute }}>Set your monthly income to see this.</p>
          ) : emergencyFund.targetAmount <= 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>Set a needs percentage above 0% in Budget to calculate a real safety net target — it&apos;s part of this plan.</p>
          ) : testAmount <= 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>Set a monthly amount above to see where this plan leads.</p>
          ) : totalMonths !== null ? (
            <>
              <p className="text-4xl" style={{ ...SERIF, ...NUMS, color: T.brass }}>{stabilityDateDisplay}</p>
              <p className="text-xs mt-1" style={{ color: T.mute }}>
                Safety net funded, debt-free, and every current goal met, {totalMonths === 0 ? "today" : `${totalMonths} month${totalMonths === 1 ? "" : "s"} from now`}, at {money(testAmount)}/mo.
              </p>

              {/* Simple proportional timeline "graph" */}
              <div className="h-3 rounded-full overflow-hidden flex mt-4" style={{ background: T.line }}>
                {priority.map((key) => {
                  const s = stages[key];
                  const widthPct = totalMonths > 0 ? Math.max(2, ((s.months ?? 0) / totalMonths) * 100) : 0;
                  return <div key={key} style={{ width: `${widthPct}%`, background: PRIORITY_META[key].color(T) }} title={PRIORITY_META[key].label} />;
                })}
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs mt-3" style={{ color: T.mute }}>
                {priority.map((key, i) => (
                  <span key={key}>{i + 1}. {PRIORITY_META[key].label}: <span style={{ color: T.text }}>{stages[key].months === 0 ? "already there" : stages[key].dateDisplay ?? "…"}</span></span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm" style={{ color: T.coral }}>{stopReason ?? "Not reachable at this monthly amount."}</p>
          )}
        </div>

        {/* Safety net */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Safety net</p>
            <span className="text-xs tabular-nums" style={{ color: T.mute }}>{money(emergencyFund.balance)} of {money(emergencyFund.targetAmount)}</span>
          </div>
          <Bar pct={emergencyFund.pctFunded} color={T.jade} T={T} />
          {!hasIncome || emergencyFund.targetAmount <= 0 ? (
            <p className="text-sm mt-4" style={{ color: T.mute }}>Set your income to calculate a real target here.</p>
          ) : emergencyFund.remaining <= 0 ? (
            <p className="text-sm mt-4" style={{ color: T.jade }}>Fully funded already. 🎉</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 mt-4">
              <PaceRow label="At recommended pace" months={efRecommendedPace.months} dateDisplay={efRecommendedPace.dateDisplay} color={T.text} T={T} />
              <PaceRow label="In your plan" months={stages.ef.months} dateDisplay={stages.ef.dateDisplay} color={T.jade} T={T} />
            </div>
          )}
        </div>

        {/* Debt */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Debt</p>
            {liveDebts.length > 0 && <span className="text-xs tabular-nums" style={{ color: T.coral }}>{money(debt.totalBalance)} owed</span>}
          </div>
          {liveDebts.length === 0 ? (
            <p className="text-sm" style={{ color: T.jade }}>Debt-free already. 🏁</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <PaceRow
                label="Your current plan"
                months={debt.plan?.feasible ? debt.plan.months : null}
                dateDisplay={debt.plan?.feasible ? debt.plan.debtFreeDateDisplay : null}
                color={T.text} T={T}
              />
              <PaceRow label="In your plan" months={stages.debt.months} dateDisplay={stages.debt.dateDisplay} color={T.jade} T={T} />
            </div>
          )}
          {stages.debt.warning && (
            <p className="text-xs mt-3" style={{ color: T.coral }}>{stages.debt.warning}</p>
          )}
        </div>

        {/* Goals -- F3 (Goal Feasibility Engine) sub-phase 3: per-goal breakdown + conflict banner, replacing the old lumped "combined" pair (2.4.44, live bug fixed as a side effect of this wiring). */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Goals</p>
            {goalAllocationReport && goalAllocationReport.goals.length > 0 && (
              <button
                type="button"
                onClick={() => setShowFastest((v) => !v)}
                aria-pressed={showFastest}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-opacity hover:opacity-80 flex-shrink-0"
                style={{
                  background: showFastest ? T.brass + "22" : "transparent",
                  border: `1px solid ${showFastest ? T.brass : T.line}`,
                  color: showFastest ? T.brass : T.mute,
                }}
              >
                {showFastest ? "✓ Fastest possible" : "Show fastest possible"}
              </button>
            )}
          </div>
          {openGoalsWithId.length === 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>{goals.length === 0 ? "No goals yet. Add one in Goals." : "All goals achieved. 🎉"}</p>
          ) : !hasIncome ? (
            <p className="text-sm" style={{ color: T.mute }}>Set your monthly income to see this.</p>
          ) : testAmount <= 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>Set a monthly amount above to see where this plan leads.</p>
          ) : stages.goals.skipped ? (
            // hasIncome and testAmount > 0, so this can only mean an earlier
            // stage (safety net or debt, per the current priority order)
            // never finished -- goals genuinely haven't been reached yet,
            // not a data problem.
            <p className="text-sm" style={{ color: T.mute }}>This plan reaches goals only after safety net and debt are handled first — reorder priorities above, or raise the monthly amount, to see them here.</p>
          ) : !goalAllocationReport ? (
            <p className="text-sm" style={{ color: T.mute }}>Set a monthly amount above to see where your goals stand.</p>
          ) : (
            <>
              {goalAllocationReport.conflict.hasConflict && (
                <div className="rounded-xl px-3 py-2.5 mb-3" style={{ background: T.coral + "15", border: `1px solid ${T.coral}40` }}>
                  <p className="text-sm font-medium" style={{ color: T.coral }}>
                    Your goals need {money(goalAllocationReport.conflict.totalRequiredMonthlyRateUSD)}/mo combined to hit every target date — {money(goalAllocationReport.conflict.shortfallUSD)}/mo more than the {money(testAmount)}/mo this plan gives them.
                  </p>
                  <p className="text-xs mt-1" style={{ color: T.coral }}>
                    Something has to give: reorder your goals (soonest-deadline goals are funded first) or raise the monthly amount above.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                {goalAllocationReport.goals.map((result) => {
                  const dash = openGoalsWithId.find((x) => x.stored.id === result.id)!.dash;
                  const meta = GOAL_STATUS_META[result.status];
                  const fastest = fastestReport?.goals.find((f) => f.id === result.id) ?? null;
                  return (
                    <div key={result.id} className="rounded-xl px-3 py-2" style={{ background: T.panelSoft }}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm" style={{ color: T.text }}>{dash.emoji} {dash.name}</span>
                        <span className="text-[10px] uppercase tracking-widest font-medium" style={{ color: meta.color(T) }}>{meta.label}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 mt-1">
                        <span className="text-xs" style={{ color: T.mute }}>{dash.projection.pctComplete}% saved · target {dash.projection.targetDateDisplay}</span>
                        <span className="text-xs tabular-nums" style={{ color: meta.color(T) }}>
                          {/* Prefixed only while the fastest row is visible
                              beneath it: two bare dates with no labels is
                              exactly the misread this toggle exists to
                              avoid, but an unnecessary "Plan ·" on the
                              default view would be noise. */}
                          {showFastest && <span style={{ color: T.mute }}>Plan · </span>}
                          {result.projectedMonths === null ? "Not reachable" : result.projectedMonths === 0 ? "Already there" : `${result.projectedDateDisplay} (${result.projectedMonths} mo)`}
                        </span>
                      </div>
                      {fastest && (
                        <div className="flex items-center justify-between gap-3 mt-1 pt-1" style={{ borderTop: `1px dashed ${T.line}` }}>
                          <span className="text-[11px]" style={{ color: T.mute }}>If everything went here first</span>
                          <span className="text-xs tabular-nums" style={{ color: T.brass }}>
                            <span style={{ color: T.mute }}>Fastest · </span>
                            {fastest.monthsToComplete === null ? "Not reachable" : fastest.monthsToComplete === 0 ? "Already there" : `${fastest.dateDisplay} (${fastest.monthsToComplete} mo)`}
                          </span>
                        </div>
                      )}
                      {result.shortfallMonthlyRateUSD > 0 && (
                        <p className="text-[11px] mt-1" style={{ color: T.mute }}>
                          Needs {money(result.shortfallMonthlyRateUSD)}/mo more to hit its own target date at this priority.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Scoped deliberately to goals, not to the control as a whole:
                  the safety-net and debt stages above DO finish sooner as the
                  monthly amount rises (they call projectCompletion/
                  simulateDebtPayoff with the full testAmount, uncapped). It's
                  the goals stage alone that can't accelerate --
                  allocateGoalCapacity caps each goal at
                  requiredMonthlyRateUSD, derived from that goal's own
                  targetDate, and passes the surplus to the next goal rather
                  than finishing any goal early. Disclaiming the whole slider
                  would be wrong about two of its three stages. */}
              <p className="text-[11px] mt-3 pt-3" style={{ color: T.mute, borderTop: `1px solid ${T.line}` }}>
                Each goal is funded up to what it needs to arrive on its own target date, and anything left over passes to the next goal in priority order. Raising the monthly amount can rescue a goal that&apos;s behind — it won&apos;t pull one in ahead of its target date. Safety net and debt above do finish sooner as you raise it.
                {/* The sentence above describes the plan and stays true
                    whether or not the toggle is on. This one explains what
                    the second date means, so the two read as one
                    explanation rather than as a contradiction: the plan
                    doesn't pull goals in early, and this is what it would
                    take if it did. */}
                {showFastest && (
                  <>
                    {" "}
                    <span style={{ color: T.brass }}>
                      The fastest line ignores target dates entirely: it puts every available dollar into the soonest goal until it&apos;s done, then the next. It&apos;s what this amount could do, not what the plan above does.
                    </span>
                  </>
                )}
              </p>
            </>
          )}
        </div>

      </div>
    </main>
  );
}
