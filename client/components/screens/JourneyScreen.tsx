"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { LocalFinancials } from "../../lib/localData";
import { DEFAULT_LBP_RATE } from "../../lib/localData";
import type { computeDashboard } from "../../lib/computeDashboard";
import { projectCompletion } from "../../lib/projections";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, NUMS, money, type Screen } from "./shared";
import Donut from "../charts/Donut";

const ymStrLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} '${String(y).slice(2)}`;
};

function Beat({ eyebrow, children, color }: { eyebrow: string; children: React.ReactNode; color?: string }) {
  const T = useTheme();
  return (
    <div className="rounded-2xl p-6" style={{ background: T.panel, border: `1px solid ${color ?? T.line}` }}>
      <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: color ?? T.mute }}>{eyebrow}</p>
      {children}
    </div>
  );
}

export default function JourneyScreen({
  financials, dashData, onNavigate,
}: {
  financials: LocalFinancials;
  dashData: ReturnType<typeof computeDashboard>;
  onNavigate: (s: Screen) => void;
}) {
  const T = useTheme();
  const firstName = (dashData.user.name || "You").split(" ")[0];
  const nwColor = dashData.netWorth.tierColor === "jade" ? T.jade : dashData.netWorth.tierColor === "brass" ? T.brass : dashData.netWorth.tierColor === "coral" ? T.coral : T.mute;

  // ── Net worth arc ────────────────────────────────────────────────
  const nwHistory = financials.netWorthHistory ?? [];
  const hasNwArc = nwHistory.length >= 2;
  const nwFirst = hasNwArc ? nwHistory[0].value : null;
  const nwLatest = dashData.netWorth.total;
  const nwChange = nwFirst !== null ? nwLatest - nwFirst : 0;

  // ── Savings-rate arc (reuses the same 6-month trend the Overview chart shows) ──
  // rateOf uses savingsContrib specifically (money actually put into the
  // Savings bucket), the exact same formula as month.savingsRatePct --
  // NOT income-minus-total-spend, which is unallocated leftover cash and
  // reads as ~0 for anyone who fully allocates their spend across Needs/
  // Wants/Savings, understating a real, on-target saver.
  const activeMonths = dashData.sixMonthTrend.filter((m) => m.income > 0);
  const rateOf = (m: { income: number; savingsContrib: number }) => Math.round((m.savingsContrib / m.income) * 100);
  const hasRateArc = activeMonths.length >= 2;
  const rateFirst = hasRateArc ? rateOf(activeMonths[0]) : null;
  const rateLatest = hasRateArc ? rateOf(activeMonths[activeMonths.length - 1]) : dashData.month.savingsRatePct > 0 ? Math.round(dashData.month.savingsRatePct) : null;
  const rateChartData = activeMonths.map((m) => ({ ymKey: m.ymKey, rate: rateOf(m) }));
  const ymKeyLabel = (k: number) => {
    const y = Math.floor(k / 100), m = k % 100;
    return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} '${String(y).slice(2)}`;
  };

  // ── Category shift: earliest vs. latest calendar month with logged transactions ──
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const toUSD = (n: number, cur?: string) => (cur === "LBP" ? n / lbpRate : n);
  const byMonth: Record<string, { needs: number; wants: number; savings: number }> = {};
  for (const t of financials.transactions) {
    // This arc is specifically about the Needs/Wants/Savings spend mix --
    // one-off INCOME transactions aren't spend, and the old catch-all
    // (anything not NEEDS/WANTS landed in savings) would have miscounted
    // them as extra savings.
    if (t.bucket === "INCOME") continue;
    const k = t.date.slice(0, 7);
    const b = byMonth[k] ?? (byMonth[k] = { needs: 0, wants: 0, savings: 0 });
    const usd = toUSD(t.amount, t.currency);
    if (t.bucket === "NEEDS") b.needs += usd; else if (t.bucket === "WANTS") b.wants += usd; else b.savings += usd;
  }
  const txMonths = Object.keys(byMonth).sort();
  const pctOf = (b: { needs: number; wants: number; savings: number }) => {
    const total = b.needs + b.wants + b.savings;
    return total > 0 ? { wants: Math.round((b.wants / total) * 100), savings: Math.round((b.savings / total) * 100) } : null;
  };
  const hasCategoryArc = txMonths.length >= 2;
  const catFirst = hasCategoryArc ? pctOf(byMonth[txMonths[0]]) : null;
  const catLatest = hasCategoryArc ? pctOf(byMonth[txMonths[txMonths.length - 1]]) : null;
  const latestMonthKey = txMonths.length > 0 ? txMonths[txMonths.length - 1] : null;
  const latestMonthTotals = latestMonthKey ? byMonth[latestMonthKey] : null;
  const latestMonthLabel = latestMonthKey ? ymStrLabel(latestMonthKey) : null;

  // ── Milestones ───────────────────────────────────────────────────
  const totalTx = financials.transactions.length;
  const goalsAchieved = financials.goals.filter((g) => g.achievedAt).length;
  const debtsPaidOff = financials.debts.filter((d) => d.paidOffAt).length;

  // ── What's next: same EF pace math as the Projections page ─────────
  const efRate = dashData.effectiveBudgetTargets.savings;
  const efProjection = projectCompletion(dashData.emergencyFund.remaining, efRate);

  const started = hasNwArc || hasRateArc || hasCategoryArc || totalTx > 0;

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-2xl mx-auto space-y-5">

        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>{firstName}&apos;s money story</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>
            {started
              ? "A quick look back at how far things have come, and where they're headed."
              : "Every story starts with a first entry. Log a transaction or two, and this page starts filling in."}
          </p>
        </div>

        {/* Net worth arc */}
        <Beat eyebrow="Where you stand">
          {hasNwArc ? (
            <>
              <p className="text-xl leading-snug" style={SERIF}>
                You started at <span style={{ ...NUMS, color: T.mute }}>{money(nwFirst!)}</span>. Today you&apos;re at{" "}
                <span style={{ ...NUMS, color: nwChange >= 0 ? T.jade : T.coral }}>{money(nwLatest)}</span>.
              </p>
              <p className="text-sm mt-2" style={{ color: T.mute }}>
                That&apos;s {nwChange >= 0 ? "up" : "down"} <span style={{ color: nwChange >= 0 ? T.jade : T.coral, ...NUMS }}>{money(Math.abs(nwChange))}</span> since your first tracked month, {nwChange >= 0 ? "real progress worth noticing." : "and now you know exactly where to focus."}
              </p>
              {dashData.netWorthTrend.length >= 2 && (
                <div className="h-36 mt-4 -ml-2">
                  <ResponsiveContainer>
                    <LineChart data={dashData.netWorthTrend} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
                      <XAxis dataKey="ym" tickFormatter={ymStrLabel} tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} width={54} />
                      <Tooltip
                        contentStyle={{ background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 12, color: T.text }}
                        labelFormatter={(v) => ymStrLabel(String(v))}
                        formatter={(v: number) => [money(v), "Net worth"]}
                      />
                      <Line type="monotone" dataKey="value" stroke={nwColor} strokeWidth={2} dot={{ r: 3, fill: nwColor }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          ) : (
            <p className="text-xl leading-snug" style={SERIF}>
              Right now your net worth is <span style={{ ...NUMS, color: nwLatest >= 0 ? T.jade : T.coral }}>{money(nwLatest)}</span>. That&apos;s today&apos;s starting line, come back next month to see the first chapter.
            </p>
          )}
        </Beat>

        {/* Savings rate arc */}
        <Beat eyebrow="Your saving habit">
          {hasRateArc && rateFirst !== null && rateLatest !== null ? (
            <>
              <p className="text-xl leading-snug" style={SERIF}>
                You went from saving <span style={{ ...NUMS, color: T.mute }}>{rateFirst}%</span> of your income to{" "}
                <span style={{ ...NUMS, color: T.jade }}>{rateLatest}%</span>.
              </p>
              <p className="text-sm mt-2" style={{ color: T.mute }}>
                {rateLatest > rateFirst
                  ? "That's the habit compounding: small, repeated choices adding up to something real."
                  : rateLatest === rateFirst
                  ? "Steady as it goes. Consistency is its own kind of win."
                  : "It slipped a bit, worth a look at what changed, not a reason to give up."}
              </p>
              <div className="h-36 mt-4 -ml-2">
                <ResponsiveContainer>
                  <LineChart data={rateChartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
                    <XAxis dataKey="ymKey" tickFormatter={ymKeyLabel} tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 12, color: T.text }}
                      labelFormatter={(v) => ymKeyLabel(Number(v))}
                      formatter={(v: number) => [`${v}%`, "Savings rate"]}
                    />
                    <Line type="monotone" dataKey="rate" stroke={T.jade} strokeWidth={2} dot={{ r: 3, fill: T.jade }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : rateLatest !== null ? (
            <p className="text-xl leading-snug" style={SERIF}>
              You&apos;re saving <span style={{ ...NUMS, color: T.jade }}>{rateLatest}%</span> of your income this month. That&apos;s the number this story will track from here.
            </p>
          ) : (
            <p className="text-sm" style={{ color: T.mute }}>Log some income and spending to start tracking your saving habit here.</p>
          )}
        </Beat>

        {/* Category shift */}
        <Beat eyebrow="How your spending has shifted">
          {hasCategoryArc && catFirst && catLatest && (
            <>
              <p className="text-xl leading-snug" style={SERIF}>
                Wants went from <span style={{ ...NUMS, color: T.mute }}>{catFirst.wants}%</span> of your spending to{" "}
                <span style={{ ...NUMS, color: T.brass }}>{catLatest.wants}%</span>, and Savings from{" "}
                <span style={{ ...NUMS, color: T.mute }}>{catFirst.savings}%</span> to{" "}
                <span style={{ ...NUMS, color: T.jade }}>{catLatest.savings}%</span>.
              </p>
              <p className="text-sm mt-2" style={{ color: T.mute }}>
                {catLatest.savings >= catFirst.savings
                  ? "You're putting more of every dollar to work for your future than when you started."
                  : "Wants crept up a little. Not a crisis, just a pattern worth noticing next time you log a purchase."}
              </p>
            </>
          )}
          {latestMonthTotals && (latestMonthTotals.needs + latestMonthTotals.wants + latestMonthTotals.savings) > 0 ? (
            <div className={`flex items-center gap-6 flex-wrap ${hasCategoryArc ? "mt-5 pt-5" : ""}`} style={hasCategoryArc ? { borderTop: `1px solid ${T.line}` } : undefined}>
              <Donut
                segments={[
                  { value: latestMonthTotals.needs, color: T.sky, label: "Needs" },
                  { value: latestMonthTotals.wants, color: T.brass, label: "Wants" },
                  { value: latestMonthTotals.savings, color: T.jade, label: "Savings" },
                ]}
                trackColor={T.line}
                labelColor={T.text}
                size={110}
                thickness={16}
                centerLabel={money(latestMonthTotals.needs + latestMonthTotals.wants + latestMonthTotals.savings)}
                centerSublabel={latestMonthLabel ?? undefined}
              />
              <div className="flex-1 min-w-[160px] space-y-1.5 text-sm">
                <span className="flex items-center gap-2" style={{ color: T.mute }}><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: T.sky }} /> Needs · <span style={{ color: T.text }}>{money(latestMonthTotals.needs)}</span></span>
                <span className="flex items-center gap-2" style={{ color: T.mute }}><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: T.brass }} /> Wants · <span style={{ color: T.text }}>{money(latestMonthTotals.wants)}</span></span>
                <span className="flex items-center gap-2" style={{ color: T.mute }}><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: T.jade }} /> Savings · <span style={{ color: T.text }}>{money(latestMonthTotals.savings)}</span></span>
              </div>
            </div>
          ) : !hasCategoryArc && (
            <p className="text-sm" style={{ color: T.mute }}>Once you&apos;ve logged transactions across a couple of months, this section shows how your Needs, Wants, and Savings mix has changed. See the full breakdown anytime in Transactions.</p>
          )}
        </Beat>

        {/* Milestones */}
        {(totalTx > 0 || goalsAchieved > 0 || debtsPaidOff > 0) && (
          <Beat eyebrow="Milestones so far">
            <div className="flex flex-wrap gap-4">
              {totalTx > 0 && (
                <div>
                  <p className="text-2xl" style={{ ...SERIF, ...NUMS, color: T.text }}>{totalTx}</p>
                  <p className="text-xs" style={{ color: T.mute }}>transaction{totalTx === 1 ? "" : "s"} logged</p>
                </div>
              )}
              {goalsAchieved > 0 && (
                <div>
                  <p className="text-2xl" style={{ ...SERIF, ...NUMS, color: T.jade }}>{goalsAchieved}</p>
                  <p className="text-xs" style={{ color: T.mute }}>goal{goalsAchieved === 1 ? "" : "s"} achieved</p>
                </div>
              )}
              {debtsPaidOff > 0 && (
                <div>
                  <p className="text-2xl" style={{ ...SERIF, ...NUMS, color: T.jade }}>{debtsPaidOff}</p>
                  <p className="text-xs" style={{ color: T.mute }}>debt{debtsPaidOff === 1 ? "" : "s"} paid off</p>
                </div>
              )}
              {dashData.emergencyFund.balance > 0 && (
                <div>
                  <p className="text-2xl" style={{ ...SERIF, ...NUMS, color: T.jade }}>{money(dashData.emergencyFund.balance)}</p>
                  <p className="text-xs" style={{ color: T.mute }}>built into your safety net</p>
                </div>
              )}
            </div>
          </Beat>
        )}

        {/* What's next */}
        <Beat eyebrow="What's next" color={T.brass}>
          {dashData.month.income <= 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>Set your income to see where this story is headed.</p>
          ) : dashData.emergencyFund.targetAmount <= 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>Set a needs percentage above 0% in Budget to see where this story is headed.</p>
          ) : efProjection.months === 0 ? (
            <p className="text-xl leading-snug" style={SERIF}>Your safety net is fully built. That&apos;s the foundation the rest of this story stands on.</p>
          ) : efProjection.months !== null ? (
            <>
              <p className="text-xl leading-snug" style={SERIF}>
                Keep this pace and your safety net is complete by <span style={{ ...NUMS, color: T.brass }}>{efProjection.dateDisplay}</span>.
              </p>
              <button
                onClick={() => onNavigate("projections")}
                className="text-xs font-semibold mt-3 hover:opacity-80 transition-opacity"
                style={{ color: T.brass }}
              >
                See the full path to financial stability →
              </button>
            </>
          ) : (
            <p className="text-sm" style={{ color: T.mute }}>There&apos;s no monthly room left for this right now. The Projections page can help you see where to find it.</p>
          )}
        </Beat>

      </div>
    </main>
  );
}
