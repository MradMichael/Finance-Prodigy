"use client";

import { useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { BUDGET_RULES } from "../../lib/localData";
import { dateFmt, type computeDashboard } from "../../lib/computeDashboard";
import { simulateDebtPayoff, addMonths, type DebtInput } from "../../lib/debtEngine";
import { projectCompletion } from "../../lib/projections";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, NUMS, money } from "./shared";

type PriorityKey = "ef" | "debt" | "goals";
const PRIORITY_META: Record<PriorityKey, { label: string; color: (T: ReturnType<typeof useTheme>) => string }> = {
  ef:    { label: "Safety net", color: (T) => T.jade },
  debt:  { label: "Debt",           color: (T) => T.coral },
  goals: { label: "Goals",          color: (T) => T.brass },
};

interface StageResult { months: number | null; startMonths: number; dateDisplay: string | null; warning?: string | null; skipped?: boolean }

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
  const { emergencyFund, debt, goals, effectiveBudgetTargets, budgetTargetPct, budgetRule, month } = dashData;

  const hasIncome = month.income > 0;
  const efRemaining = Math.max(0, emergencyFund.remaining);
  const liveDebts: DebtInput[] = financials.debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ id: d.id, name: d.name, balance: d.balance, aprPct: d.apr, minimumPayment: d.minPayment }));
  const openGoals = goals.filter((g) => g.projection.pctComplete < 100);
  const totalGoalsRemaining = openGoals.reduce((s, g) => s + Math.max(0, g.targetAmount - g.currentAmount), 0);

  // The one number that drives every projection below — directly set, not a
  // hidden sum of "recommended savings + something else" (that combination
  // read as a bug the first time it shipped: dial the slider to $150 and
  // the plan quietly used $425). Starts at the recommended savings figure
  // since that's a real, explained number, not zero.
  const [testAmount, setTestAmount] = useState(() => Math.max(0, Math.round(effectiveBudgetTargets.savings)));
  const surplus = Math.max(0, Math.round(month.netCashFlow));
  const sliderMax = Math.max(200, testAmount * 2, surplus * 2);

  // What order the plan tackles things in — user-controlled, not hardcoded.
  // A dollar can only be spent once: this is what makes the plan below a
  // single realistic sequence instead of the same amount tested against
  // each goal independently (which is what shipped before this and was
  // confusing: "I can't put $150 toward three different things at once").
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
  for (const key of priority) {
    if (!feasible) { stages[key] = { months: null, startMonths: cursor, dateDisplay: null, skipped: true }; continue; }
    const startDate = addMonths(new Date(), cursor);
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
      const proj = projectCompletion(totalGoalsRemaining, testAmount, startDate);
      stages.goals = { months: proj.months, startMonths: cursor, dateDisplay: proj.dateDisplay };
      if (proj.months === null) { feasible = false; stopReason = "Goals aren't reachable at this monthly amount."; } else cursor += proj.months;
    }
  }
  const totalMonths = feasible ? cursor : null;
  const stabilityDateDisplay = totalMonths !== null ? dateFmt(addMonths(new Date(), totalMonths)) : null;

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
          <p className="text-xs uppercase tracking-widest mb-2" style={{ color: T.mute }}>Recommended monthly savings</p>
          {hasIncome ? (
            <>
              <p className="text-4xl" style={{ ...SERIF, ...NUMS, color: T.jade }}>{money(effectiveBudgetTargets.savings)}<span className="text-base" style={{ color: T.mute }}>/mo</span></p>
              <p className="text-xs mt-2" style={{ color: T.mute }}>
                {budgetTargetPct.savings}% of income under your {BUDGET_RULES[budgetRule].label} rule, adjusted for last month&apos;s rollover.
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
                  type="number" min={0} step={10}
                  value={testAmount}
                  onChange={(e) => setTestAmount(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  className="w-24 rounded-lg px-2 py-1 text-sm font-semibold tabular-nums text-right"
                  style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.brass }}
                />
              </div>
            </div>
            <input
              type="range" min={0} max={sliderMax} step={10}
              value={Math.min(testAmount, sliderMax)}
              onChange={(e) => setTestAmount(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: T.brass }}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                { label: "Recommended savings", v: Math.round(effectiveBudgetTargets.savings) },
                { label: `My full surplus (${money(surplus)})`, v: surplus },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => setTestAmount(p.v)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                  style={{
                    background: testAmount === p.v ? T.brass + "22" : T.panelSoft,
                    border: `1px solid ${testAmount === p.v ? T.brass : T.line}`,
                    color: testAmount === p.v ? T.brass : T.mute,
                  }}
                >
                  {p.label}
                </button>
              ))}
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
              <PaceRow label="At recommended pace" months={projectCompletion(efRemaining, effectiveBudgetTargets.savings).months} dateDisplay={projectCompletion(efRemaining, effectiveBudgetTargets.savings).dateDisplay} color={T.text} T={T} />
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

        {/* Goals */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: T.mute }}>Goals</p>
          {openGoals.length === 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>{goals.length === 0 ? "No goals yet. Add one in Goals." : "All goals achieved. 🎉"}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 pb-4" style={{ borderBottom: `1px solid ${T.line}` }}>
                <PaceRow label="At required pace (combined)" months={Math.max(0, ...openGoals.map((g) => g.projection.monthsRemaining))} dateDisplay={null} color={T.text} T={T} />
                <PaceRow label="In your plan (combined)" months={stages.goals.months} dateDisplay={stages.goals.dateDisplay} color={T.jade} T={T} />
              </div>
              <div className="space-y-2 mt-3">
                {openGoals.map((g) => (
                  <div key={g.id} className="flex items-center justify-between text-sm">
                    <span style={{ color: T.text }}>{g.emoji} {g.name}</span>
                    <span style={{ color: T.mute }}>{g.projection.pctComplete}% saved · target {g.projection.targetDateDisplay}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

      </div>
    </main>
  );
}
