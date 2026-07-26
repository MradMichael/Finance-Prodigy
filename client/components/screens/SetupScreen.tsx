"use client";

import type { LocalFinancials, BudgetRuleKey } from "../../lib/localData";
import { BUDGET_RULES } from "../../lib/localData";
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
      ⚠ Rate last updated {label}{stale ? " — LBP moves fast, double-check it's still accurate" : ""}.
    </p>
  );
}

export default function SetupScreen({
  financials,
  onChange,
}: {
  financials: LocalFinancials;
  onChange: (f: LocalFinancials) => void;
}) {
  const T = useTheme();
  const update = (patch: Partial<LocalFinancials>) => onChange({ ...financials, ...patch });

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
            <label className="block text-xs mb-1.5" style={{ color: T.mute }}>Your name</label>
            <input
              className="w-full rounded-xl px-4 py-2.5 text-sm"
              style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
              value={financials.userName}
              onChange={(e) => update({ userName: e.target.value })}
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="block text-xs mb-1.5" style={{ color: T.mute }}>Monthly income (USD)</label>
            <input
              className="w-full rounded-xl px-4 py-2.5 text-sm tabular-nums"
              style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
              type="number" min="0" step="100"
              value={financials.income || ""}
              onChange={(e) => update({ income: Math.max(0, parseFloat(e.target.value) || 0) })}
              placeholder="e.g. 3500"
            />
          </div>
        </div>

        {/* Currency */}
        <div className="rounded-2xl p-6 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Currency</p>
          <div>
            <label className="block text-xs mb-1.5" style={{ color: T.mute }}>LBP / USD exchange rate</label>
            <input
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

        {/* Emergency Fund */}
        <div className="rounded-2xl p-6 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Emergency Fund</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs mb-1.5" style={{ color: T.mute }}>Target (months of income)</label>
              <input
                className="w-full rounded-xl px-4 py-2.5 text-sm tabular-nums"
                style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
                type="number" min="1" max="24"
                value={financials.emergencyFundTargetMonths}
                onChange={(e) => update({ emergencyFundTargetMonths: Math.max(1, parseInt(e.target.value) || 6) })}
              />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: T.mute }}>Current balance ($)</label>
              <input
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
                ${(financials.income * financials.emergencyFundTargetMonths).toLocaleString()}
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
                const key   = label === "Needs" ? "budgetCustomNeeds" : "budgetCustomWants";
                const val   = label === "Needs" ? (financials.budgetCustomNeeds ?? 50) : (financials.budgetCustomWants ?? 30);
                const other = label === "Needs" ? (financials.budgetCustomWants ?? 30) : (financials.budgetCustomNeeds ?? 50);
                const maxVal = Math.max(0, 100 - other);
                return (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-2">
                      <span style={{ color: T.mute }}>{label}</span>
                      <span className="font-semibold" style={{ color: T.jade }}>{val}%</span>
                    </div>
                    <input
                      type="range" min={0} max={maxVal} step={5} value={Math.min(val, maxVal)}
                      onChange={(e) => update({ [key]: parseInt(e.target.value) })}
                      className="w-full" style={{ accentColor: T.jade }}
                    />
                  </div>
                );
              })}
              <div className="flex justify-between items-center pt-1" style={{ borderTop: `1px solid ${T.line}` }}>
                <span className="text-xs" style={{ color: T.mute }}>Savings (auto-calculated)</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: T.jade }}>
                  {Math.max(0, 100 - (financials.budgetCustomNeeds ?? 50) - (financials.budgetCustomWants ?? 30))}%
                </span>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
