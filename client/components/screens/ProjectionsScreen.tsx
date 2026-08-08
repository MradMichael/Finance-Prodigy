"use client";

import { useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { BUDGET_RULES } from "../../lib/localData";
import { dateFmt, type computeDashboard } from "../../lib/computeDashboard";
import { simulateDebtPayoff, type DebtInput } from "../../lib/debtEngine";
import { projectCompletion } from "../../lib/projections";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, NUMS, money } from "./shared";

function Bar({ pct, color, T }: { pct: number; color: string; T: ReturnType<typeof useTheme> }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: T.line }}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color, transition: "width 0.8s ease" }} />
    </div>
  );
}

/** "3 mo, by 14-09-2028" / "not at this rate" — the shared current-vs-boosted readout used by all three scenario cards below. */
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

  const defaultExtra = Math.max(0, Math.round(month.netCashFlow));
  const [extra, setExtra] = useState(defaultExtra);
  const sliderMax = Math.max(200, defaultExtra * 3);

  const hasIncome = month.income > 0;
  const efBaseRate = effectiveBudgetTargets.savings;
  const efCurrent  = projectCompletion(emergencyFund.remaining, efBaseRate);
  const efBoosted  = projectCompletion(emergencyFund.remaining, efBaseRate + extra);

  const liveDebts: DebtInput[] = financials.debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ id: d.id, name: d.name, balance: d.balance, aprPct: d.apr, minimumPayment: d.minPayment }));
  const debtBoosted = liveDebts.length > 0 ? simulateDebtPayoff(liveDebts, extra, "AVALANCHE") : null;

  const openGoals = goals.filter((g) => g.projection.pctComplete < 100);

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">

        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Projections</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>
            Where your emergency fund, debt, and goals are headed at your current pace, and how much sooner extra money gets you there.
          </p>
        </div>

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

        {/* Interactive lever */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Extra monthly amount to test</p>
            <p className="text-lg font-semibold tabular-nums" style={{ ...SERIF, color: T.brass }}>{money(extra)}</p>
          </div>
          <input
            type="range" min={0} max={sliderMax} step={10}
            value={Math.min(extra, sliderMax)}
            onChange={(e) => setExtra(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: T.brass }}
          />
          <div className="flex flex-wrap gap-2">
            {[
              { label: "None", v: 0 },
              { label: "Half my surplus", v: Math.round(defaultExtra / 2) },
              { label: `Full surplus (${money(defaultExtra)})`, v: defaultExtra },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => setExtra(p.v)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                style={{
                  background: extra === p.v ? T.brass + "22" : T.panelSoft,
                  border: `1px solid ${extra === p.v ? T.brass : T.line}`,
                  color: extra === p.v ? T.brass : T.mute,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[10px]" style={{ color: T.mute }}>
            Each card below shows what happens if this whole amount went to that one goal on its own, not all three added together.
          </p>
        </div>

        {/* Emergency fund */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Emergency fund</p>
            <span className="text-xs tabular-nums" style={{ color: T.mute }}>{money(emergencyFund.balance)} of {money(emergencyFund.targetAmount)}</span>
          </div>
          <Bar pct={emergencyFund.pctFunded} color={T.jade} T={T} />
          {emergencyFund.remaining <= 0 ? (
            <p className="text-sm mt-4" style={{ color: T.jade }}>Fully funded already. 🎉</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 mt-4">
              <PaceRow label="At recommended pace" months={efCurrent.months} dateDisplay={efCurrent.dateDisplay} color={T.text} T={T} />
              <PaceRow label={`With +${money(extra)}/mo`} months={efBoosted.months} dateDisplay={efBoosted.dateDisplay} color={T.jade} T={T} />
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
              <PaceRow
                label={`With +${money(extra)}/mo extra`}
                months={debtBoosted?.feasible ? debtBoosted.months : null}
                dateDisplay={debtBoosted?.feasible && debtBoosted.debtFreeDate ? dateFmt(new Date(debtBoosted.debtFreeDate)) : null}
                color={T.jade} T={T}
              />
            </div>
          )}
          {debtBoosted && !debtBoosted.feasible && debtBoosted.warning && (
            <p className="text-xs mt-3" style={{ color: T.coral }}>{debtBoosted.warning}</p>
          )}
        </div>

        {/* Goals */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: T.mute }}>Goals</p>
          {openGoals.length === 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>{goals.length === 0 ? "No goals yet. Add one in Goals." : "All goals achieved. 🎉"}</p>
          ) : (
            <div className="space-y-4">
              {openGoals.map((g) => {
                const remaining = Math.max(0, g.targetAmount - g.currentAmount);
                const boosted = projectCompletion(remaining, g.projection.requiredMonthly + extra);
                return (
                  <div key={g.id} className="pb-4 last:pb-0" style={{ borderBottom: `1px solid ${T.line}` }}>
                    <p className="text-sm font-medium mb-2" style={{ color: T.text }}>{g.emoji} {g.name}</p>
                    <div className="grid grid-cols-2 gap-4">
                      <PaceRow label="At required pace" months={g.projection.monthsRemaining} dateDisplay={g.projection.targetDateDisplay} color={T.text} T={T} />
                      <PaceRow label={`With +${money(extra)}/mo`} months={boosted.months} dateDisplay={boosted.dateDisplay} color={T.jade} T={T} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
