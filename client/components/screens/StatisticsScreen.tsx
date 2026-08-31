"use client";

import type { LocalFinancials } from "../../lib/localData";
import { nextOccurrence, isRecurringActive, historizedRecurringContribution, valueForMonth, toUSD as toUSDShared, activeTransactions, DEFAULT_LBP_RATE } from "../../lib/localData";
import type { computeDashboard } from "../../lib/computeDashboard";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, NUMS, money } from "./shared";

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtYmKey(ymKey: number): string {
  const s = String(ymKey);
  return `${MONTH_NAMES[+s.slice(4, 6)]} ${s.slice(0, 4)}`;
}

export default function StatisticsScreen({
  financials, dashData,
}: {
  financials: LocalFinancials;
  dashData: ReturnType<typeof computeDashboard>;
}) {
  const T = useTheme();
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const toUSD = (n: number, cur?: string) => toUSDShared(n, cur as "USD" | "LBP" | undefined, lbpRate);
  const now = new Date();
  // Phase 2.6.3b: soft-deleted transactions excluded from every total below.
  const activeTx = activeTransactions(financials.transactions);

  // ── Cash flow trend + table (same underlying data, two views) ──────
  const trend = dashData.sixMonthTrend;
  const trendMax = Math.max(1, ...trend.map((t) => Math.max(t.income, t.spend)));
  // sixMonthTrend is always a fixed 6-month window (never an empty array,
  // even for a brand-new account), so the "trend.length === 0" checks below
  // used to never actually fire -- a zero-state audit (2026-08-31) found a
  // wall of six $0-in/$0-out rows shown silently instead. Checking for real
  // activity, not array length, matches JourneyScreen's own pattern for the
  // identical "nothing logged yet" case right next to this screen in the nav.
  const hasTrendActivity = trend.some((t) => t.income > 0 || t.spend > 0);

  // ── Period comparison: this month vs last month, transactions +
  // recurring blended in (matching how every other screen treats "this
  // month's real numbers"). ──
  const thisYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastYm = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

  // Salary (valueForMonth(incomeHistory, ...), same historized lookup
  // computeDashboard.ts's own incomeForMonth uses) plus any one-off INCOME
  // transactions that month -- summing only logged INCOME-bucket
  // transactions would show $0 for anyone paid via the Setup income field
  // instead of logging each paycheck as a transaction, disagreeing with
  // the trend chart right above this on the same page.
  function incomeForMonth(ym: string): number {
    const salary = valueForMonth(financials.incomeHistory, ym, financials.income);
    const txIncome = activeTx
      .filter((t) => t.bucket === "INCOME" && t.date.startsWith(ym))
      .reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
    return salary + txIncome;
  }

  function periodTotals(ym: string, recurAsOf: Date) {
    const tx = activeTx.filter((t) => t.date.startsWith(ym));
    const txSum = (bucket: string) => tx.filter((t) => t.bucket === bucket).reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
    const out = { income: incomeForMonth(ym), needs: txSum("NEEDS"), wants: txSum("WANTS"), savings: txSum("SAVINGS") };
    for (const r of financials.recurring ?? []) {
      const usd = toUSD(historizedRecurringContribution(r, ym, recurAsOf), r.currency);
      if (r.bucket === "NEEDS") out.needs += usd;
      else if (r.bucket === "WANTS") out.wants += usd;
      else out.savings += usd;
    }
    return out;
  }
  const thisMonth = periodTotals(thisYm, now);
  const lastMonth = periodTotals(lastYm, lastMonthDate);
  const delta = (a: number, b: number) => a - b;
  const comparisonRows: { label: string; a: number; b: number }[] = [
    { label: "Income", a: thisMonth.income, b: lastMonth.income },
    { label: "Needs", a: thisMonth.needs, b: lastMonth.needs },
    { label: "Wants", a: thisMonth.wants, b: lastMonth.wants },
    { label: "Savings", a: thisMonth.savings, b: lastMonth.savings },
    // AUD-09 (external audit, 2026-08-28): omitted savings, overstating Net
    // by exactly the savings amount and disagreeing with the canonical
    // dashData.month.netCashFlow (income - needs - wants - savings) this
    // same screen already shows in the Net worth forecast section below.
    { label: "Net", a: thisMonth.income - thisMonth.needs - thisMonth.wants - thisMonth.savings, b: lastMonth.income - lastMonth.needs - lastMonth.wants - lastMonth.savings },
  ];
  const hasComparisonActivity = comparisonRows.some((r) => r.a !== 0 || r.b !== 0);

  // ── Planned payments timeline: next 30 days, every occurrence (not
  // just the next one) for items that repeat more than once in that
  // window -- 6 occurrences per item is a generous cap against a
  // pathological weekly/biweekly item looping past the window forever. ──
  const TIMELINE_DAYS = 30;
  const timelineEnd = new Date(now.getTime() + TIMELINE_DAYS * 24 * 3600 * 1000);
  const timeline: { key: string; name: string; emoji: string; amountUSD: number; date: Date }[] = [];
  for (const r of financials.recurring ?? []) {
    if (!isRecurringActive(r, now)) continue;
    let cursor = now;
    for (let i = 0; i < 6; i++) {
      const next = nextOccurrence(r, cursor);
      if (!next || next > timelineEnd) break;
      timeline.push({ key: `${r.id}-${i}`, name: r.name, emoji: r.emoji, amountUSD: toUSD(r.amount, r.currency), date: next });
      cursor = new Date(next.getTime() + 24 * 3600 * 1000);
    }
  }
  timeline.sort((a, b) => a.date.getTime() - b.date.getTime());
  const timelineTotal = timeline.reduce((s, t) => s + t.amountUSD, 0);

  // ── Balance forecast: a light, directional projection (current net
  // worth carried forward at this month's net cash flow) -- distinct
  // from Projections' detailed debt/goal payoff planning, which already
  // covers "when will X be paid off," not "where does my overall number
  // trend." ──
  const netCashFlow = dashData.month.netCashFlow;
  const currentNetWorth = dashData.netWorth.total;
  const forecastCheckpoints = [3, 6, 12].map((months) => ({ months, projected: currentNetWorth + netCashFlow * months }));

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">

        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Statistics</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>Trends, comparisons, and what&apos;s coming — all in USD.</p>
        </div>

        {/* Cash flow trend */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest mb-4" style={{ color: T.mute }}>Cash flow trend</p>
          {!hasTrendActivity ? (
            <p className="text-sm" style={{ color: T.mute }}>Once you&apos;ve logged income and spending, this fills in with your last 6 months.</p>
          ) : (
            <div className="space-y-3">
              {trend.map((t) => (
                <div key={t.ymKey}>
                  <div className="flex justify-between text-[10px] mb-1" style={{ color: T.mute }}>
                    <span>{fmtYmKey(t.ymKey)}</span>
                    <span>{money(t.income)} in · {money(t.spend)} out</span>
                  </div>
                  <div className="relative h-2 rounded-full overflow-hidden" style={{ background: T.line }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(t.income / trendMax) * 100}%`, background: T.jade }} />
                  </div>
                  <div className="relative h-2 rounded-full overflow-hidden mt-1" style={{ background: T.line }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(t.spend / trendMax) * 100}%`, background: T.coral }} />
                  </div>
                </div>
              ))}
              <div className="flex gap-4 text-[10px] pt-1" style={{ color: T.mute }}>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: T.jade }} /> Income</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: T.coral }} /> Spent</span>
              </div>
            </div>
          )}
        </div>

        {/* Period comparison */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest mb-4" style={{ color: T.mute }}>This month vs. last month</p>
          {!hasComparisonActivity ? (
            <p className="text-sm" style={{ color: T.mute }}>Once you&apos;ve logged a month or two, this compares them side by side.</p>
          ) : (
          <div className="space-y-2.5">
            {comparisonRows.map((row) => {
              const d = delta(row.a, row.b);
              const goodIsUp = row.label !== "Needs" && row.label !== "Wants"; // spending down is the "good" direction
              const deltaColor = d === 0 ? T.mute : (d > 0) === goodIsUp ? T.jade : T.coral;
              return (
                <div key={row.label} className="flex items-center justify-between text-sm">
                  <span style={{ color: T.mute }}>{row.label}</span>
                  <span className="tabular-nums" style={{ ...NUMS }}>
                    <span style={{ color: T.text }}>{money(row.a)}</span>
                    <span style={{ color: T.mute }}> vs {money(row.b)} </span>
                    <span style={{ color: deltaColor }}>({d >= 0 ? "+" : ""}{money(d)})</span>
                  </span>
                </div>
              );
            })}
          </div>
          )}
        </div>

        {/* Planned payments timeline */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Planned payments, next {TIMELINE_DAYS} days</p>
            {timeline.length > 0 && <span className="text-xs tabular-nums" style={{ color: T.brass }}>{money(timelineTotal)} total</span>}
          </div>
          {timeline.length === 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>Nothing recurring due in the next {TIMELINE_DAYS} days.</p>
          ) : (
            <div className="space-y-2">
              {timeline.map((t) => (
                <div key={t.key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2" style={{ color: T.text }}>
                    {t.emoji} {t.name}
                    <span className="text-[10px]" style={{ color: T.mute }}>
                      {t.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                    </span>
                  </span>
                  <span className="tabular-nums" style={{ color: T.mute }}>{money(t.amountUSD)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Balance forecast */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: T.mute }}>Net worth forecast</p>
          <p className="text-[11px] mb-4" style={{ color: T.mute }}>
            Today&apos;s net worth ({money(currentNetWorth)}) carried forward at this month&apos;s net cash flow ({netCashFlow >= 0 ? "+" : ""}{money(netCashFlow)}/mo). A directional estimate, not a plan — see Projections for debt/goal payoff timing.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {forecastCheckpoints.map((c) => (
              <div key={c.months} className="rounded-xl px-3 py-3" style={{ background: T.ink }}>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>{c.months} months</p>
                <p className="text-base font-medium tabular-nums mt-0.5" style={{ ...SERIF, color: c.projected >= currentNetWorth ? T.jade : T.coral }}>{money(c.projected)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Cash flow table / monthly book */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest mb-4" style={{ color: T.mute }}>Monthly book (USD)</p>
          {!hasTrendActivity ? (
            <p className="text-sm" style={{ color: T.mute }}>Once you&apos;ve logged income and spending, each month&apos;s book appears here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.line}` }}>
                    <th className="text-left py-2 pr-3 font-normal uppercase tracking-wider" style={{ color: T.mute }}>Month</th>
                    <th className="text-right py-2 px-3 font-normal uppercase tracking-wider" style={{ color: T.mute }}>Income</th>
                    <th className="text-right py-2 px-3 font-normal uppercase tracking-wider" style={{ color: T.mute }}>Spent</th>
                    <th className="text-right py-2 px-3 font-normal uppercase tracking-wider" style={{ color: T.mute }}>Saved</th>
                    <th className="text-right py-2 pl-3 font-normal uppercase tracking-wider" style={{ color: T.mute }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((t) => {
                    const net = t.income - t.spend;
                    return (
                      <tr key={t.ymKey} style={{ borderBottom: `1px solid ${T.line}` }}>
                        <td className="py-2 pr-3" style={{ color: T.text }}>{fmtYmKey(t.ymKey)}</td>
                        <td className="text-right py-2 px-3 tabular-nums" style={{ color: T.jade }}>{money(t.income)}</td>
                        <td className="text-right py-2 px-3 tabular-nums" style={{ color: T.coral }}>{money(t.spend)}</td>
                        <td className="text-right py-2 px-3 tabular-nums" style={{ color: T.text }}>{money(t.savingsContrib)}</td>
                        <td className="text-right py-2 pl-3 tabular-nums font-medium" style={{ color: net >= 0 ? T.jade : T.coral }}>{net >= 0 ? "+" : ""}{money(net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
