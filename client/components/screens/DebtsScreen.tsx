"use client";

import type { LocalFinancials } from "../../lib/localData";
import { fmtDate, toUSD as toUSDShared, derivedDebtBalance, DEFAULT_LBP_RATE } from "../../lib/localData";
import type { computeDashboard } from "../../lib/computeDashboard";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, NUMS, money, fmtCur } from "./shared";

export default function DebtsScreen({ financials, dashData }: { financials: LocalFinancials; dashData: ReturnType<typeof computeDashboard> }) {
  const T = useTheme();
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  // Phase 2.6.3a: each debt's balance is derived once here (openingBalance
  // minus every linked, non-deleted transaction), not read from the stored
  // `balance` field -- same computation computeDashboard.ts does for the
  // health score and payoff plan, so this screen's own numbers can't
  // disagree with those.
  const debtBalances = new Map(financials.debts.map((d) => [d.id, derivedDebtBalance(d, financials.transactions)]));
  // Paid-off debts stay in the array for history -- their minPayment is
  // never cleared, so summing over every debt unfiltered keeps counting a
  // payment obligation that no longer exists, and never triggers the
  // debt-free state once the last active debt is paid. A debt is "paid off"
  // once its derived balance reaches 0, not via a separate stored flag.
  const activeDebts = financials.debts.filter((d) => (debtBalances.get(d.id) ?? 0) > 0);
  // Summed across debts that may carry different currencies -- USD is the
  // only sensible display for a combined figure (same reasoning as every
  // other cross-record aggregation in Phase 1.4).
  const totalBal  = activeDebts.reduce((s, d) => s + toUSDShared(debtBalances.get(d.id) ?? 0, d.currency, lbpRate), 0);
  const totalMin  = activeDebts.reduce((s, d) => s + toUSDShared(d.minPayment, d.currency, lbpRate), 0);
  const plan      = dashData.debt.plan;

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Debts</h1>
        </div>

        {activeDebts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-3xl mb-3" style={SERIF}>Debt-free. 🏁</p>
            <p className="text-sm" style={{ color: T.mute }}>Every dollar you earn works for your future.</p>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl px-4 py-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.mute }}>Total balance</p>
                <p className="text-2xl font-medium tabular-nums" style={{ ...SERIF, color: T.coral }}>{money(totalBal)}</p>
              </div>
              <div className="rounded-2xl px-4 py-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.mute }}>Min. payments / mo</p>
                <p className="text-2xl font-medium tabular-nums" style={{ ...SERIF, color: T.text }}>{money(totalMin)}</p>
              </div>
            </div>

            {/* Debt-free date banner */}
            {plan?.feasible && plan.debtFreeDateDisplay && (
              <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: T.mute }}>Debt-free date</p>
                <p className="text-5xl" style={{ ...SERIF, ...NUMS, color: T.brass }}>{plan.debtFreeDateDisplay}</p>
                <div className="flex flex-wrap gap-x-5 text-xs mt-3" style={{ color: T.mute }}>
                  <span>{plan.months} months to go</span>
                  <span>at <span style={{ color: T.text }}>{money(plan.monthlyCommitment)}/mo</span></span>
                  <span>lifetime interest <span style={{ color: T.coral }}>{money(plan.totalInterest)}</span></span>
                </div>
              </div>
            )}

            {/* Snowball vs Avalanche comparison */}
            {dashData.debt.comparison && (
              <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
                <p className="text-xs uppercase tracking-widest mb-4" style={{ color: T.mute }}>Snowball vs. Avalanche</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl p-4" style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}>
                    <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: T.mute }}>Snowball</p>
                    <p className="text-[10px] mb-3" style={{ color: T.mute }}>Smallest balance first</p>
                    <p className="text-lg font-semibold tabular-nums" style={{ ...SERIF, color: T.text }}>{dashData.debt.comparison.snowball.months} mo</p>
                    <p className="text-xs mt-1" style={{ color: T.coral }}>{money(dashData.debt.comparison.snowball.totalInterest)} interest</p>
                  </div>
                  <div className="rounded-xl p-4" style={{ background: T.panelSoft, border: `1px solid ${T.jade}50` }}>
                    <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: T.jade }}>Avalanche</p>
                    <p className="text-[10px] mb-3" style={{ color: T.mute }}>Highest APR first</p>
                    <p className="text-lg font-semibold tabular-nums" style={{ ...SERIF, color: T.text }}>{dashData.debt.comparison.avalanche.months} mo</p>
                    <p className="text-xs mt-1" style={{ color: T.coral }}>{money(dashData.debt.comparison.avalanche.totalInterest)} interest</p>
                  </div>
                </div>
                {dashData.debt.comparison.avalancheSavesVsSnowball > 0 && (
                  <p className="text-xs mt-4" style={{ color: T.jade }}>
                    Avalanche saves {money(dashData.debt.comparison.avalancheSavesVsSnowball)} in interest over Snowball on this debt load. The tradeoff is fewer quick wins along the way.
                  </p>
                )}
              </div>
            )}

            {/* Individual debts */}
            <div className="space-y-3">
              {financials.debts.map((d) => {
                const balance = debtBalances.get(d.id) ?? 0;
                const monthlyInt = (d.apr / 100 / 12) * balance;
                return (
                  <div key={d.id} className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}`, opacity: d.paidOffAt ? 0.65 : 1 }}>
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <p className="font-medium" style={{ color: T.text }}>
                        {d.name}
                        {d.paidOffAt && (
                          <span className="ml-1.5 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: T.jade + "22", color: T.jade }}>Paid off</span>
                        )}
                      </p>
                      <p className="text-xl font-semibold tabular-nums flex-shrink-0" style={{ ...SERIF, color: d.paidOffAt ? T.jade : T.coral }}>{fmtCur(balance, d.currency)}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{ color: T.mute }}>
                      <span>APR <span style={{ color: T.text }}>{d.apr}%</span></span>
                      <span>Min payment <span style={{ color: T.text }}>{fmtCur(d.minPayment, d.currency)}/mo</span></span>
                      <span>Monthly interest <span style={{ color: T.coral }}>{fmtCur(monthlyInt, d.currency)}</span></span>
                      {d.paidOffAt && <span style={{ color: T.jade }}>Paid {fmtDate(d.paidOffAt)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
