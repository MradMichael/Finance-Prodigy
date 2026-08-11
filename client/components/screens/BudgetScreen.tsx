"use client";

import { useEffect } from "react";
import type { LocalFinancials, BudgetRuleKey } from "../../lib/localData";
import { BUDGET_RULES, MIN_SPLIT_PCT, floorCustomSplit } from "../../lib/localData";
import type { computeDashboard } from "../../lib/computeDashboard";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, money } from "./shared";

export default function BudgetScreen({
  financials,
  dashData,
  onChange,
}: {
  financials: LocalFinancials;
  dashData: ReturnType<typeof computeDashboard>;
  onChange: (f: LocalFinancials) => void;
}) {
  const T = useTheme();
  const { month } = dashData;
  const income = month.income;

  const ruleKey: BudgetRuleKey = financials.budgetRule ?? "50-30-20";
  const customNeeds = financials.budgetCustomNeeds ?? 50;
  const customWants = financials.budgetCustomWants ?? 30;

  // One-time heal for a split saved before MIN_SPLIT_PCT existed (e.g.
  // Needs at 0%) -- corrects it on load instead of leaving broken data in
  // place until the user happens to touch a slider themselves.
  useEffect(() => {
    if (ruleKey !== "custom") return;
    const healed = floorCustomSplit(customNeeds, customWants);
    if (healed.needs !== customNeeds || healed.wants !== customWants) {
      onChange({ ...financials, budgetCustomNeeds: healed.needs, budgetCustomWants: healed.wants });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleKey, customNeeds, customWants]);

  const targetPct = ruleKey === "custom"
    ? floorCustomSplit(customNeeds, customWants)
    : { needs: BUDGET_RULES[ruleKey].needs, wants: BUDGET_RULES[ruleKey].wants, savings: BUDGET_RULES[ruleKey].savings };

  // dashData.effectiveBudgetTargets, not a local recompute -- this is the
  // rollover-adjusted target that Overview's BucketRow (and budgetPace's
  // "on track"/"over" status) actually judges spend against. Recomputing
  // income * pct/100 here ignored rollover entirely, so this screen could
  // show "healthy headroom" against a looser un-rolled-over target while
  // Overview showed a "watch"/"over" warning for the identical spend.
  const targetAmt = dashData.effectiveBudgetTargets;

  const actual = { needs: month.needsSpend, wants: month.wantsSpend, savings: month.savingsContrib };

  // Smart suggestion: find the tightest rule where needs% >= actual needs%
  const actualNeedsPct = income > 0 ? (actual.needs / income) * 100 : 0;
  function suggestRule(): BudgetRuleKey {
    const ordered: BudgetRuleKey[] = ["40-30-30", "50-30-20", "60-20-20", "70-20-10", "80-15-5"];
    for (const k of ordered) {
      if (BUDGET_RULES[k].needs >= actualNeedsPct) return k;
    }
    return "custom";
  }
  const suggested = suggestRule();
  const showSuggestion = income > 0 && suggested !== ruleKey && ruleKey !== "custom"
    && actualNeedsPct > BUDGET_RULES[ruleKey].needs;

  function applyRule(k: BudgetRuleKey) {
    onChange({ ...financials, budgetRule: k });
  }

  const buckets = [
    { key: "needs"   as const, label: "Needs",   color: T.sky,   actual: actual.needs,   target: targetAmt.needs,   pct: targetPct.needs   },
    { key: "wants"   as const, label: "Wants",   color: T.brass, actual: actual.wants,   target: targetAmt.wants,   pct: targetPct.wants   },
    { key: "savings" as const, label: "Savings", color: T.jade,  actual: actual.savings, target: targetAmt.savings, pct: targetPct.savings },
  ];

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Budget</h1>
          <p className="text-sm mt-1" style={{ color: T.mute }}>
            Pick the split that fits your income. You can always adjust it.
          </p>
        </div>

        {/* Smart suggestion banner */}
        {showSuggestion && (
          <div className="rounded-2xl p-4 space-y-2" style={{ background: T.brass + "14", border: `1px solid ${T.brass}40` }}>
            <p className="text-sm font-semibold" style={{ color: T.brass }}>A better fit might be available</p>
            <p className="text-xs leading-relaxed" style={{ color: T.mute }}>
              Your needs are taking <strong style={{ color: T.text }}>{Math.round(actualNeedsPct)}%</strong> of income this month,
              more than the <strong style={{ color: T.text }}>{BUDGET_RULES[ruleKey].needs}%</strong> your current split allows.
              The <strong style={{ color: T.text }}>{BUDGET_RULES[suggested].label}</strong> model ({BUDGET_RULES[suggested].desc.toLowerCase()}) would be a more realistic fit.
            </p>
            <button
              onClick={() => applyRule(suggested)}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
              style={{ background: T.brass, color: T.ink }}
            >
              Switch to {BUDGET_RULES[suggested].label}
            </button>
          </div>
        )}

        {/* Rule picker grid */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <h2 className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Budget model</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {(Object.entries(BUDGET_RULES) as [BudgetRuleKey, typeof BUDGET_RULES[BudgetRuleKey]][])
              .filter(([k]) => k !== "custom")
              .map(([k, r]) => {
                const active = ruleKey === k;
                return (
                  <button
                    key={k}
                    onClick={() => applyRule(k)}
                    className="rounded-xl p-3.5 text-left transition-all hover:opacity-90"
                    style={{
                      background: active ? T.jade + "1A" : T.panelSoft,
                      border: `1px solid ${active ? T.jade : T.line}`,
                    }}
                  >
                    <p className="text-sm font-bold" style={{ color: active ? T.jade : T.text }}>{r.label}</p>
                    <p className="text-[10px] mt-0.5 leading-snug" style={{ color: T.mute }}>{r.desc}</p>
                    <div className="flex gap-1.5 mt-2.5 text-[9px] font-medium">
                      <span style={{ color: T.sky }}>N·{r.needs}%</span>
                      <span style={{ color: T.line }}>·</span>
                      <span style={{ color: T.brass }}>W·{r.wants}%</span>
                      <span style={{ color: T.line }}>·</span>
                      <span style={{ color: T.jade }}>S·{r.savings}%</span>
                    </div>
                    {active && <span className="text-[9px] mt-1.5 block" style={{ color: T.jade }}>✓ active</span>}
                  </button>
                );
              })}

            {/* Custom tile */}
            <button
              onClick={() => applyRule("custom")}
              className="rounded-xl p-3.5 text-left transition-all hover:opacity-90"
              style={{
                background: ruleKey === "custom" ? T.jade + "1A" : T.panelSoft,
                border: `1px solid ${ruleKey === "custom" ? T.jade : T.line}`,
              }}
            >
              <p className="text-sm font-bold" style={{ color: ruleKey === "custom" ? T.jade : T.text }}>Custom</p>
              <p className="text-[10px] mt-0.5 leading-snug" style={{ color: T.mute }}>Set your own percentages</p>
              {ruleKey === "custom" && <span className="text-[9px] mt-1.5 block" style={{ color: T.jade }}>✓ active</span>}
            </button>
          </div>

          {/* Custom sliders */}
          {ruleKey === "custom" && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
              <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Custom percentages</p>
              {(["Needs", "Wants"] as const).map((label) => {
                const field  = label === "Needs" ? "budgetCustomNeeds" as const : "budgetCustomWants" as const;
                const val    = label === "Needs" ? customNeeds : customWants;
                const other  = label === "Needs" ? customWants : customNeeds;
                const maxVal = Math.max(MIN_SPLIT_PCT, 100 - other);
                return (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span style={{ color: T.mute }}>{label}</span>
                      <span style={{ color: T.jade }}>{val}%</span>
                    </div>
                    <input
                      type="range" min={MIN_SPLIT_PCT} max={maxVal} step={5}
                      value={Math.min(Math.max(val, MIN_SPLIT_PCT), maxVal)}
                      onChange={(e) => onChange({ ...financials, [field]: parseInt(e.target.value) })}
                      className="w-full" style={{ accentColor: T.jade }}
                    />
                    {val < 10 && (
                      <p className="text-[10px] mt-1" style={{ color: T.brass }}>
                        {label} this low means almost none of your spending counts as {label.toLowerCase()}. Intentional?
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="flex justify-between text-xs pt-1" style={{ borderTop: `1px solid ${T.line}` }}>
                <span style={{ color: T.mute }}>Savings (auto)</span>
                <span style={{ color: T.jade }}>
                  {Math.max(0, 100 - customNeeds - customWants)}%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* This month vs target */}
        {income === 0 ? (
          <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <p className="text-sm" style={{ color: T.mute }}>
              Set your monthly income in <strong style={{ color: T.text }}>My Finances → Setup</strong> to see how your spending compares to this budget.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl p-5 space-y-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <h2 className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>This month vs target</h2>

            {buckets.map(({ key, label, color, actual: act, target: tgt, pct }) => {
              const barPct   = tgt > 0 ? (act / tgt) * 100 : 0;
              const over     = act > tgt;
              const headroom = tgt - act;
              return (
                <div key={key}>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-sm" style={{ color: T.text }}>
                      {label}
                      <span className="ml-1.5 text-[10px]" style={{ color: T.mute }}>target {pct}% · {money(tgt)}</span>
                    </span>
                    <span className="text-sm tabular-nums font-medium" style={{ color: over ? T.coral : color }}>
                      {money(act)}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden" style={{ background: T.line }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(100, barPct)}%`, background: barPct > 100 ? T.coral : color }}
                    />
                  </div>
                  <p className="text-[10px] mt-1" style={{ color: over ? T.coral : T.mute }}>
                    {over
                      ? `${money(-headroom)} over. Consider trimming ${label.toLowerCase()} or switching to a looser model`
                      : `${money(headroom)} of headroom left`}
                  </p>
                </div>
              );
            })}

            {/* Net summary row */}
            <div className="grid grid-cols-2 gap-3 pt-4" style={{ borderTop: `1px solid ${T.line}` }}>
              <div className="rounded-xl px-4 py-3" style={{ background: T.panelSoft }}>
                <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: T.mute }}>Savings rate</p>
                <p className="text-lg font-semibold tabular-nums" style={{ color: T.jade }}>
                  {month.savingsRatePct.toFixed(1)}%
                  <span className="text-xs font-normal ml-1" style={{ color: T.mute }}>of income</span>
                </p>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: T.panelSoft }}>
                <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: T.mute }}>Net cash flow</p>
                <p className="text-lg font-semibold tabular-nums" style={{ color: month.netCashFlow >= 0 ? T.jade : T.coral }}>
                  {month.netCashFlow >= 0 ? "+" : ""}{money(month.netCashFlow)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Low-income note */}
        {income > 0 && actualNeedsPct > 65 && (
          <div className="rounded-2xl p-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <p className="text-xs font-semibold mb-1" style={{ color: T.text }}>A note on tight budgets</p>
            <p className="text-xs leading-relaxed" style={{ color: T.mute }}>
              When most of your income goes to essentials, classical budget rules stop being useful benchmarks.
              The goal isn&apos;t to hit an arbitrary split. It&apos;s to keep essentials covered, avoid debt, and save
              whatever margin exists. The <strong style={{ color: T.text }}>Survival (80/15/5)</strong> model or
              <strong style={{ color: T.text }}> Custom</strong> mode let you set targets that actually reflect your reality.
            </p>
          </div>
        )}

      </div>
    </main>
  );
}
