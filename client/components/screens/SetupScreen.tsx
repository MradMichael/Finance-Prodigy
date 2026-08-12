"use client";

import type { LocalFinancials, BudgetRuleKey } from "../../lib/localData";
import { BUDGET_RULES, MIN_SPLIT_PCT, floorCustomSplit } from "../../lib/localData";
import type { computeDashboard } from "../../lib/computeDashboard";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF } from "./shared";

// LBP is volatile enough that a stale rate silently undermines the app's
// one real differentiator (accurate dual-currency tracking) — surface it
// instead of letting it quietly go out of date unnoticed.
function RateStaleness({ updatedAt }: { updatedAt?: string }) {
  const T = useTheme();
  if (!updatedAt) return null;
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
  if (days < 3) return null; // recently updated — no need to nag
  const stale = days >= 14;
  const color = stale ? T.coral : T.brass;
  const label = `${days} days ago`; // never 1 (unreachable, gated above at days < 3)
  return (
    <p className="text-[11px] mt-1.5 px-1 font-medium" style={{ color }}>
      ⚠ Rate last updated {label}{stale ? ". LBP moves fast, double-check it's still accurate" : ""}.
    </p>
  );
}

export default function SetupScreen({
  financials,
  dashData,
  onChange,
}: {
  financials: LocalFinancials;
  dashData: ReturnType<typeof computeDashboard>;
  onChange: (f: LocalFinancials) => void;
}) {
  const T = useTheme();
  const update = (patch: Partial<LocalFinancials>) => onChange({ ...financials, ...patch });

  // Reads computeDashboard.ts's own emergencyFund.targetAmount instead of
  // recomputing locally -- this used to multiply financials.income (the
  // raw stored salary) by target-months directly, disagreeing with
  // Overview/Projections in two ways: it ignored the needs% factor (~2x
  // too high), and it ignored any one-off INCOME transaction logged this
  // month, which computeDashboard.ts folds into effective income.
  const efTarget = dashData.emergencyFund.targetAmount;

  // Proof, not just a promise, that a raise/job change doesn't rewrite past
  // months -- incomeHistory (snapshotted per calendar month by app/page.tsx
  // whenever income actually changes) already drives every past-month
  // calculation (sixMonthTrend, budgetRollover, savingsStreak all read it
  // via computeDashboard.ts's incomeForMonth), this just makes that visible.
  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-");
    return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m]} ${y}`;
  };
  const incomeHistoryDisplay = [...(financials.incomeHistory ?? [])]
    .sort((a, b) => b.ym.localeCompare(a.ym))
    .slice(0, 6)
    .map((h) => ({ ym: h.ym, value: h.value, label: monthLabel(h.ym) }));

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-xl mx-auto space-y-6">

        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Setup</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>Configure your profile and financial preferences.</p>
        </div>

        {financials.income === 0 && (
          <div className="rounded-2xl px-5 py-4" style={{ background: T.brass + "18", border: `1px solid ${T.brass}35`, color: T.brass }}>
            <p className="text-sm font-medium">Set your monthly income to unlock the dashboard</p>
            <p className="text-xs mt-1 opacity-70">All insights, budgets, and projections are calculated from your income.</p>
          </div>
        )}

        {/* Profile */}
        <div className="rounded-2xl p-6 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Profile</p>

          <div>
            <label htmlFor="setup-name" className="block text-xs mb-1.5" style={{ color: T.mute }}>Your name</label>
            <input
              id="setup-name"
              className="w-full rounded-xl px-4 py-2.5 text-sm"
              style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
              value={financials.userName}
              onChange={(e) => update({ userName: e.target.value })}
              placeholder="Your name"
            />
          </div>

          <div>
            <label htmlFor="setup-income" className="block text-xs mb-1.5" style={{ color: T.mute }}>Monthly income (USD)</label>
            <input
              id="setup-income"
              className="w-full rounded-xl px-4 py-2.5 text-sm tabular-nums"
              style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
              type="number" min="0" step="100"
              value={financials.income || ""}
              onChange={(e) => update({ income: Math.max(0, parseFloat(e.target.value) || 0) })}
              placeholder="e.g. 3500"
            />
            <p className="text-[11px] mt-1.5 px-1" style={{ color: T.mute }}>
              Changing this only affects this month onward — a raise or a new job never rewrites how past months were judged. A one-off bonus or gift doesn&apos;t belong here; log it as an Income entry in My Finances instead.
            </p>
            {incomeHistoryDisplay.length > 1 && (
              <div className="mt-3 rounded-xl px-3 py-2.5 space-y-1.5" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Income history</p>
                {incomeHistoryDisplay.map((h) => (
                  <div key={h.ym} className="flex justify-between text-xs">
                    <span style={{ color: T.mute }}>{h.label}</span>
                    <span className="tabular-nums" style={{ color: T.text }}>${h.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Currency */}
        <div className="rounded-2xl p-6 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Currency</p>
          <div>
            <label htmlFor="setup-lbp-rate" className="block text-xs mb-1.5" style={{ color: T.mute }}>LBP / USD exchange rate</label>
            <input
              id="setup-lbp-rate"
              className="w-full rounded-xl px-4 py-2.5 text-sm tabular-nums"
              style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
              type="number" min="0" step="500"
              value={financials.lbpRate ?? 89500}
              onChange={(e) => {
                // Only commit — and only stamp "just updated" — on a real,
                // valid, positive number. The old `parseFloat(...) || 89500`
                // silently discarded an empty/zero/invalid keystroke by
                // snapping the stored rate back to the hardcoded default,
                // while still stamping lbpRateUpdatedAt as if the user's
                // input had been accepted — the staleness indicator would
                // report a rate as "just verified" the same moment real
                // input was thrown away. Leaving the field alone mid-edit
                // (rather than forcing it to 0) also avoids ever storing
                // lbpRate as 0, which computeDashboard.ts would divide by.
                const parsed = parseFloat(e.target.value);
                if (!isNaN(parsed) && parsed > 0) {
                  update({ lbpRate: parsed, lbpRateUpdatedAt: new Date().toISOString() });
                }
              }}
              placeholder="89500"
            />
            <p className="text-[11px] mt-1.5 px-1" style={{ color: T.mute }}>
              Used to convert L£ amounts to $ across the app. Update this when the rate changes.
            </p>
            <RateStaleness updatedAt={financials.lbpRateUpdatedAt} />
          </div>
        </div>

        {/* Safety net */}
        <div className="rounded-2xl p-6 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Safety net</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="ef-target-months" className="block text-xs mb-1.5" style={{ color: T.mute }}>Target (months of income)</label>
              <input
                id="ef-target-months"
                className="w-full rounded-xl px-4 py-2.5 text-sm tabular-nums"
                style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
                type="number" min="1" max="24"
                value={financials.emergencyFundTargetMonths}
                onChange={(e) => {
                  // Same rule as the LBP-rate field above: only commit a
                  // real, in-range number. The old `parseInt(...) || 6`
                  // snapped back to 6 on every keystroke of clearing the
                  // field to retype, and typing digits before an existing
                  // value (instead of clearing it first) could silently
                  // clamp to 24 instead of the intended number, with no way
                  // to tell the commit didn't match what was typed.
                  const parsed = parseInt(e.target.value, 10);
                  if (!isNaN(parsed) && parsed >= 1 && parsed <= 24) {
                    update({ emergencyFundTargetMonths: parsed });
                  }
                }}
              />
            </div>
            <div>
              <label htmlFor="ef-balance" className="block text-xs mb-1.5" style={{ color: T.mute }}>Current balance ($)</label>
              <input
                id="ef-balance"
                className="w-full rounded-xl px-4 py-2.5 text-sm tabular-nums"
                style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
                type="number" min="0" step="100"
                value={financials.emergencyFundBalance || ""}
                onChange={(e) => update({ emergencyFundBalance: Math.max(0, parseFloat(e.target.value) || 0) })}
                placeholder="0"
              />
            </div>
          </div>
          {financials.income > 0 && (
            <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: T.ink }}>
              <span className="text-xs" style={{ color: T.mute }}>Target amount</span>
              <span className="text-sm font-medium tabular-nums" style={{ color: T.jade }}>
                ${efTarget.toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* Budget split */}
        <div className="rounded-2xl p-6 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Budget split model</p>
          <p className="text-[11px]" style={{ color: T.mute }}>
            Choose how to split your income into Needs, Wants, and Savings. You can also set custom percentages.
          </p>

          <div className="space-y-2">
            {(Object.keys(BUDGET_RULES) as BudgetRuleKey[]).map((k) => {
              const rule   = BUDGET_RULES[k];
              const active = (financials.budgetRule ?? "50-30-20") === k;
              return (
                <button
                  key={k}
                  onClick={() => update({ budgetRule: k })}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all"
                  style={{
                    background: active ? T.jade + "18" : T.panelSoft,
                    border: `1px solid ${active ? T.jade : T.line}`,
                  }}
                >
                  <div>
                    <p className="text-sm font-semibold" style={{ color: active ? T.jade : T.text }}>{rule.label}</p>
                    <p className="text-[11px]" style={{ color: T.mute }}>{rule.desc}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    {k !== "custom" && (
                      <div className="hidden sm:flex gap-1.5 text-[10px]" style={{ color: T.mute }}>
                        <span style={{ color: T.sky }}>{rule.needs}% N</span>
                        <span>·</span>
                        <span style={{ color: T.brass }}>{rule.wants}% W</span>
                        <span>·</span>
                        <span style={{ color: T.jade }}>{rule.savings}% S</span>
                      </div>
                    )}
                    {active && <span className="text-base" style={{ color: T.jade }}>✓</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Custom sliders */}
          {(financials.budgetRule ?? "50-30-20") === "custom" && (
            <div className="rounded-xl p-4 space-y-4" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
              <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Custom percentages</p>
              {(["Needs", "Wants"] as const).map((label) => {
                // A second, independent copy of BudgetScreen.tsx's custom
                // sliders -- must floor the same way (MIN_SPLIT_PCT) or a
                // user editing the split from Setup instead of Budget can
                // still squeeze Needs/Wants to 0%, the exact bug fixed
                // elsewhere this session but missed here since this is a
                // separate implementation, not a shared component.
                const val   = label === "Needs" ? (financials.budgetCustomNeeds ?? 50) : (financials.budgetCustomWants ?? 30);
                const other = label === "Needs" ? (financials.budgetCustomWants ?? 30) : (financials.budgetCustomNeeds ?? 50);
                // Reserves MIN_SPLIT_PCT for Savings too -- see the matching
                // comment in BudgetScreen.tsx's own copy of this slider.
                const maxVal = Math.max(MIN_SPLIT_PCT, 100 - MIN_SPLIT_PCT - other);
                return (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-2">
                      <span style={{ color: T.mute }}>{label}</span>
                      <span className="font-semibold" style={{ color: T.jade }}>{val}%</span>
                    </div>
                    <input
                      type="range" min={MIN_SPLIT_PCT} max={maxVal} step={5} value={Math.min(Math.max(val, MIN_SPLIT_PCT), maxVal)}
                      onChange={(e) => {
                        // Persist the floored PAIR, not just this field --
                        // see the matching comment in BudgetScreen.tsx's own
                        // copy of this slider for why (stale label vs.
                        // clamped handle position otherwise).
                        const raw = parseInt(e.target.value);
                        const floored = label === "Needs"
                          ? floorCustomSplit(raw, financials.budgetCustomWants ?? 30)
                          : floorCustomSplit(financials.budgetCustomNeeds ?? 50, raw);
                        update({ budgetCustomNeeds: floored.needs, budgetCustomWants: floored.wants });
                      }}
                      className="w-full" style={{ accentColor: T.jade }}
                      aria-label={`Custom ${label} percentage`}
                    />
                  </div>
                );
              })}
              <div className="flex justify-between items-center pt-1" style={{ borderTop: `1px solid ${T.line}` }}>
                <span className="text-xs" style={{ color: T.mute }}>Savings (auto-calculated)</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: T.jade }}>
                  {floorCustomSplit(financials.budgetCustomNeeds ?? 50, financials.budgetCustomWants ?? 30).savings}%
                </span>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
