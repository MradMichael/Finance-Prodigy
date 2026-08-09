"use client";

/**
 * MOMENTUM — Financial Dashboard (the Motivation Engine)
 * ------------------------------------------------------
 * Drop into a Next.js App Router project, e.g.:
 *   app/page.tsx →  import FinancialDashboard from "@/components/FinancialDashboard";
 *
 * Reads GET /api/dashboard (proxied to the Express server via
 * next.config.js rewrites — see README). Ships with a realistic mock
 * payload so the screen renders before the backend is wired up.
 *
 * Design language: "ledger ink & brass" — deep green-ink surfaces,
 * brass for milestones, jade for progress, coral reserved for the few
 * places attention is genuinely needed. Engraved-serif numerals carry
 * the dates: this dashboard is about *time*, not guilt.
 */

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line,
} from "recharts";
import { useTheme } from "../contexts/ThemeContext";
import type { DashboardPayload } from "../lib/computeDashboard";
import OnboardingChecklist from "./OnboardingChecklist";
import type { Screen } from "./screens/shared";
const SERIF: React.CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };
const NUMS: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

const money = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(n);
const ymLabel = (ymKey: number) => {
  const m = ymKey % 100, y = Math.floor(ymKey / 100) % 100;
  return `${["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m]} ’${y}`;
};
const ymStrLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m]} ’${String(y).slice(2)}`;
};

// ------------------------- mock (dev only) ------------------------ //
const MOCK: DashboardPayload = {
  user: { name: "Demo User", currency: "USD", payoffStrategy: "AVALANCHE" },
  period: { year: 2026, month: 6 },
  hasLoggedTransactions: true,
  health: {
    score: 68, grade: "Building momentum",
    components: [
      { key: "savings", label: "Savings rate", score: 72, weight: 25, detail: "14% of income saved (target 20%)" },
      { key: "needs", label: "Needs discipline", score: 88, weight: 20, detail: "Essentials take 47% of income (target ≤50%)" },
      { key: "ef", label: "Safety net", score: 52, weight: 25, detail: "Safety net 52% funded" },
      { key: "debt", label: "Debt pressure", score: 61, weight: 20, detail: "Debt payments are 19% of income" },
      { key: "goals", label: "Goal momentum", score: 81, weight: 10, detail: "Average pace across active goals" },
    ],
  },
  encouragements: [
    "Your safety net is 52% built. Past halfway, the rest is downhill.",
    "Stay the course and you're debt-free by 14-09-2028. The date is already on the calendar.",
    "30 Before 30 Travel Fund is on pace: 31% there.",
  ],
  streaks: [{ key: "savings-streak", label: "Savings streak", count: 3, message: "🔥 3 months in a row hitting your savings target." }],
  month: { income: 3500, needsSpend: 1640, wantsSpend: 710, savingsContrib: 480, totalSpend: 2830, netCashFlow: 670, savingsRatePct: 13.7 },
  emergencyFund: { targetMonths: 6, targetAmount: 9840, balance: 5120, coverageMonths: 3.1, pctFunded: 52, remaining: 4720 },
  debt: {
    totalBalance: 13260, count: 3,
    plan: { feasible: true, months: 27, debtFreeDateDisplay: "14-09-2028", totalInterest: 1684, monthlyCommitment: 675 },
    comparison: {
      snowball: { feasible: true, months: 29, totalInterest: 1820, debtFreeDateDisplay: "14-11-2028" },
      avalanche: { feasible: true, months: 27, totalInterest: 1684, debtFreeDateDisplay: "14-09-2028" },
      avalancheSavesVsSnowball: 136,
    },
  },
  goals: [
    { id: 1, name: "30 Before 30 Travel Fund", emoji: "✈️", type: "TRAVEL", targetAmount: 12000, currentAmount: 3720,
      projection: { pctComplete: 31, monthsRemaining: 28, requiredMonthly: 296, paceRatio: 1.05, onTrack: true, targetDateDisplay: "01-10-2028" } },
    { id: 2, name: "Bambu Lab Upgrade", emoji: "🛠️", type: "PURCHASE", targetAmount: 1500, currentAmount: 900,
      projection: { pctComplete: 60, monthsRemaining: 4, requiredMonthly: 150, paceRatio: 1.2, onTrack: true, targetDateDisplay: "15-10-2026" } },
  ],
  sixMonthTrend: [
    { ymKey: 202601, income: 3400, spend: 3050 }, { ymKey: 202602, income: 3400, spend: 2890 },
    { ymKey: 202603, income: 3500, spend: 2960 }, { ymKey: 202604, income: 3500, spend: 2740 },
    { ymKey: 202605, income: 3500, spend: 2810 }, { ymKey: 202606, income: 3500, spend: 2830 },
  ],
  budgetRule: "50-30-20",
  budgetTargetPct: { needs: 50, wants: 30, savings: 20 },
  budgetTargets: { needs: 1750, wants: 1050, savings: 700 },
  budgetRollover: { needs: 40, wants: -60, savings: 120 },
  effectiveBudgetTargets: { needs: 1790, wants: 990, savings: 820 },
  budgetPace: [
    { bucket: "NEEDS", label: "Needs", pctOfMonthElapsed: 50, pctOfBudgetUsed: 60, projectedPct: 96, status: "ok", message: "Needs spending is on pace (60% used, 50% of the month elapsed)." },
    { bucket: "WANTS", label: "Wants", pctOfMonthElapsed: 50, pctOfBudgetUsed: 78, projectedPct: 122, status: "watch", message: "78% of Wants budget spent and it's only the 15th. At this rate, you'll exceed it by ~$94." },
    { bucket: "SAVINGS", label: "Savings", pctOfMonthElapsed: 50, pctOfBudgetUsed: 69, projectedPct: 96, status: "watch", message: "On pace for 96% of this month's savings target." },
  ],
  netWorthTrend: [
    { ym: "2026-01", value: -8100 }, { ym: "2026-02", value: -7820 }, { ym: "2026-03", value: -7400 },
    { ym: "2026-04", value: -7050 }, { ym: "2026-05", value: -6820 }, { ym: "2026-06", value: -6640 },
  ],
  upcomingRenewals: [
    { id: "1", name: "Netflix", emoji: "🎬", amount: 15.49, currency: "USD", dueDate: "2026-06-20", dueInDays: 3 },
  ],
  balanceChecks: [
    { id: "1", name: "Cash", currency: "USD", expected: 240, actual: 190, actualDate: "2026-06-18", discrepancy: -50 },
  ],
  netWorth: {
    assets: 6620, liabilities: 13260, total: -6640,
    tier: "Rebuilding", tierColor: "coral",
    suggestions: [
      "You're climbing: the negative number is shrinking each month.",
      "Consider a small side income for 3–6 months; even $200/month accelerates this significantly.",
      "Once you clear the debt, redirect that minimum payment into savings automatically.",
    ],
  },
};

// --------------------------- data hook --------------------------- //
function useDashboard(enabled: boolean) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    fetch("/api/dashboard")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(setData)
      .catch(() => { setData(MOCK); setDemo(true); });
  }, [enabled]);
  return { data, demo };
}

// --------------------------- sub-views --------------------------- //

function HealthRing({ score, grade }: { score: number; grade: string }) {
  const T = useTheme();
  const color = score >= 80 ? T.jade : score >= 60 ? T.jade : score >= 40 ? T.brass : T.coral;
  const r     = 38;
  const circ  = 2 * Math.PI * r;
  const dash  = (score / 100) * circ;
  const gap   = circ - dash;
  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke={T.line} strokeWidth="7" />
        <circle
          cx="50" cy="50" r={r} fill="none"
          stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-6">
        <span className="text-5xl font-medium tabular-nums" style={{ ...SERIF, color: T.text }}>{score}</span>
        <span className="text-[10px] tracking-widest uppercase text-center leading-tight" style={{ color }}>{grade}</span>
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  const T = useTheme();
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: T.line }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

function BucketRow({ label, actual, target, color }: { label: string; actual: number; target: number; color: string }) {
  const T = useTheme();
  const pct = target > 0 ? (actual / target) * 100 : 0;
  const headroom = target - actual;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span style={{ color: T.text }}>{label}</span>
        <span style={{ ...NUMS, color: T.mute }}>
          {money(actual)} <span style={{ color: T.line }}>/</span> {money(target)}
        </span>
      </div>
      <Bar pct={pct} color={pct > 100 ? T.coral : color} />
      <p className="text-xs mt-1" style={{ color: headroom >= 0 ? T.mute : T.coral }}>
        {headroom >= 0 ? `${money(headroom)} of room left` : `${money(-headroom)} over. Next month resets the line`}
      </p>
    </div>
  );
}

function Panel({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  const T = useTheme();
  return (
    <section className={`rounded-2xl p-5 ${className}`} style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      {title && <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: T.mute }}>{title}</h2>}
      {children}
    </section>
  );
}

// ---------------------------- screen ----------------------------- //

export default function FinancialDashboard({
  data: propData, onNavigate,
}: {
  data?: DashboardPayload;
  onNavigate?: (screen: Screen) => void;
}) {
  const T = useTheme();
  const { data: fetchedData, demo: fetchedDemo } = useDashboard(propData === undefined);
  const data = propData ?? fetchedData;
  const demo = propData === undefined && fetchedDemo;

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: T.ink, color: T.mute }}>
        Counting your wins…
      </div>
    );
  }

  const { health, month, emergencyFund: ef, debt, goals, sixMonthTrend, encouragements, user, period, netWorth, streaks, budgetPace, netWorthTrend, upcomingRenewals, balanceChecks } = data;
  const monthName = ["", "January","February","March","April","May","June","July","August","September","October","November","December"][period.month];
  const targets     = data.budgetTargets;
  const budgetLabel = data.budgetRule === "custom" ? "Custom split" : data.budgetRule.replace(/-/g, " / ");
  const budgetPct   = {
    needs:   Math.round(targets.needs   / Math.max(month.income, 1) * 100),
    wants:   Math.round(targets.wants   / Math.max(month.income, 1) * 100),
    savings: Math.round(targets.savings / Math.max(month.income, 1) * 100),
  };

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink, color: T.text }}>
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>ESSA · {monthName} {period.year}</p>
            <h1 className="text-3xl md:text-4xl mt-1" style={SERIF}>
              {month.income === 0
                ? <>Set your income to see the full picture, {user.name.split(" ")[0]}.</>
                : month.netCashFlow >= month.income * 0.2
                ? <>{user.name.split(" ")[0]}, you kept <span style={{ color: T.jade }}>{money(month.netCashFlow)}</span>, above your 20% target.</>
                : month.netCashFlow > 0
                ? <>You kept <span style={{ color: T.brass }}>{money(month.netCashFlow)}</span> this month, {user.name.split(" ")[0]}. Every dollar counts.</>
                : <>Spending exceeded income by <span style={{ color: T.coral }}>{money(-month.netCashFlow)}</span> this month, {user.name.split(" ")[0]}. The plan below shows the path.</>}
            </h1>
          </div>
          {demo && (
            <span className="text-xs px-3 py-1 rounded-full" style={{ border: `1px solid ${T.line}`, color: T.mute }}>
              demo data, API offline
            </span>
          )}
        </header>

        {/* Keeps showing until BOTH steps are actually done (not just "income
            set"), so a user who sets income first doesn't lose the nudge to
            log a transaction — it used to be gated on income === 0 alone and
            vanished the instant step 1 was done, even if step 2 wasn't. */}
        {onNavigate && !(month.income > 0 && data.hasLoggedTransactions) && (
          <OnboardingChecklist hasIncome={month.income > 0} hasTransactions={data.hasLoggedTransactions} onNavigate={onNavigate} />
        )}

        {/* Month at a glance */}
        {month.income > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Income",  value: money(month.income),        sub: "this month",                       color: T.text  },
              { label: "Spent",   value: money(month.totalSpend),    sub: `${Math.round(month.totalSpend / month.income * 100)}% of income`, color: month.totalSpend > month.income ? T.coral : T.mute },
              { label: "Saved",   value: money(month.savingsContrib), sub: `${month.savingsRatePct.toFixed(1)}% rate`,                       color: T.jade  },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="rounded-2xl px-4 py-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.mute }}>{label}</p>
                <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color }}>{value}</p>
                <p className="text-[10px] mt-1" style={{ color: T.mute }}>{sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Encouragements */}
        <div className="rounded-2xl px-5 py-4 space-y-1.5" style={{ background: T.panelSoft, borderLeft: `3px solid ${T.brass}` }}>
          {encouragements.map((e, i) => (
            <p key={i} className="text-sm" style={{ color: i === 0 ? T.text : T.mute }}>{e}</p>
          ))}
          {streaks.map((s) => (
            <p key={s.key} className="text-sm" style={{ color: T.jade }}>{s.message}</p>
          ))}
        </div>

        {/* Upcoming renewals */}
        {upcomingRenewals.length > 0 && (
          <div className="rounded-2xl px-5 py-4 flex flex-wrap gap-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <p className="text-xs uppercase tracking-widest flex-shrink-0 self-center" style={{ color: T.mute }}>Renewing soon</p>
            {upcomingRenewals.map((r) => (
              <span
                key={r.id}
                className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5"
                style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text }}
              >
                <span>{r.emoji}</span>
                <span>{r.name}</span>
                <span style={{ color: T.mute }}>· {money(r.amount)}</span>
                <span style={{ color: r.dueInDays <= 2 ? T.coral : T.brass }}>
                  · {r.dueInDays === 0 ? "today" : r.dueInDays === 1 ? "tomorrow" : `in ${r.dueInDays}d`}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* Balance check — expected (from logged transactions) vs. what you actually have.
            Purely a display of TrackedBalance data computed independently in
            computeDashboard.ts; nothing else on this page reads balanceChecks, so
            it cannot affect the health score, budget, or net worth above/below it. */}
        {balanceChecks.some((b) => b.actual != null) && (
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-widest px-1" style={{ color: T.mute }}>Balance check</p>
            <div className="grid gap-3 md:grid-cols-2">
              {balanceChecks.filter((b) => b.actual != null).map((b) => {
                const gap = b.discrepancy ?? 0;
                const mismatch = Math.abs(gap) >= 1;
                const accent = mismatch ? T.coral : T.jade;
                return (
                  <div
                    key={b.id}
                    className="rounded-2xl px-5 py-4"
                    style={{ background: T.panel, border: `1px solid ${mismatch ? T.coral + "40" : T.line}` }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="text-sm font-medium" style={{ color: T.text }}>{b.name}</span>
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide"
                        style={{ background: accent + "18", color: accent }}
                      >
                        {mismatch ? "Mismatch" : "Matches"}
                      </span>
                    </div>
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>Expected</p>
                        <p className="text-lg tabular-nums" style={{ ...SERIF, color: T.text }}>{money(b.expected)}</p>
                      </div>
                      <span style={{ color: T.mute }}>vs</span>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>You said</p>
                        <p className="text-lg tabular-nums" style={{ ...SERIF, color: T.text }}>{money(b.actual as number)}</p>
                      </div>
                    </div>
                    {mismatch && (
                      <p className="text-xs mt-3 pt-3" style={{ color: T.coral, borderTop: `1px solid ${T.coral}30` }}>
                        {gap < 0
                          ? `${money(Math.abs(gap))} unaccounted for — check for a missed entry.`
                          : `${money(gap)} more than expected — got extra cash, or a transaction logged twice?`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Row 1: health · 50/30/20 · trend */}
        <div className="grid gap-6 md:grid-cols-3">
          <Panel title="Financial health">
            <HealthRing score={health.score} grade={health.grade} />
            <div className="mt-4 space-y-3">
              {health.components.map((c) => {
                const col = c.score >= 70 ? T.jade : c.score >= 40 ? T.brass : T.coral;
                return (
                  <div key={c.key}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="text-xs" style={{ color: T.mute }}>{c.label}</span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold tabular-nums" style={{ color: col }}>{c.score}</span>
                        <span className="text-[9px]" style={{ color: T.mute }}>/ 100</span>
                      </div>
                    </div>
                    <Bar pct={c.score} color={col} />
                    <p className="text-[10px] mt-1" style={{ color: T.mute }}>{c.detail}</p>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title={`Budget · ${budgetLabel}`}>
            <div className="space-y-5">
              <BucketRow label={`Needs · ${budgetPct.needs}%`}   actual={month.needsSpend}    target={data.effectiveBudgetTargets.needs}   color={T.sky} />
              <BucketRow label={`Wants · ${budgetPct.wants}%`}   actual={month.wantsSpend}    target={data.effectiveBudgetTargets.wants}   color={T.brass} />
              <BucketRow label={`Savings · ${budgetPct.savings}%`} actual={month.savingsContrib} target={data.effectiveBudgetTargets.savings} color={T.jade} />
            </div>

            {/* Pace warnings — Copilot-style "on track to exceed" heads-up */}
            {budgetPace.filter((p) => p.status !== "ok").length > 0 && (
              <div className="mt-4 space-y-2">
                {budgetPace.filter((p) => p.status !== "ok").map((p) => (
                  <div
                    key={p.bucket}
                    className="rounded-xl px-3 py-2 text-xs"
                    style={{
                      background: p.status === "over" ? T.coral + "18" : T.brass + "18",
                      border: `1px solid ${p.status === "over" ? T.coral : T.brass}40`,
                      color: T.text,
                    }}
                  >
                    {p.message}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs mt-5 pt-4" style={{ color: T.mute, borderTop: `1px solid ${T.line}` }}>
              Savings rate this month: <span style={{ ...NUMS, color: T.jade }}>{month.savingsRatePct.toFixed(1)}%</span> of income
            </p>
          </Panel>

          <Panel title="Cash flow · last 6 months">
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={sixMonthTrend} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="inc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={T.jade} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={T.jade} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
                  <XAxis dataKey="ymKey" tickFormatter={ymLabel} tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 12, color: T.text }}
                    labelFormatter={(v) => ymLabel(Number(v))}
                    formatter={(v: number, name: string) => [money(v), name === "income" ? "Income" : "Spend"]}
                  />
                  <Area type="monotone" dataKey="income" stroke={T.jade} strokeWidth={2} fill="url(#inc)" />
                  <Area type="monotone" dataKey="spend" stroke={T.coral} strokeWidth={2} fill="transparent" strokeDasharray="5 4" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs mt-2" style={{ color: T.mute }}>
              The gap between the lines is your monthly progress. {monthName} is still in progress, so its spend line will keep rising (and the gap will keep shrinking) as the rest of the month gets logged.
            </p>
          </Panel>
        </div>

        {/* Row 2: debt countdown · emergency fund */}
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title={`Debt freedom · ${user.payoffStrategy.toLowerCase()} strategy`}>
            {debt.plan?.feasible && debt.plan.debtFreeDateDisplay ? (
              <>
                <p className="text-sm" style={{ color: T.mute }}>At {money(debt.plan.monthlyCommitment)}/month, your last payment lands</p>
                <p className="text-4xl md:text-5xl my-2" style={{ ...SERIF, ...NUMS, color: T.brass }}>
                  {debt.plan.debtFreeDateDisplay}
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mt-3" style={{ color: T.mute }}>
                  <span><span style={{ ...NUMS, color: T.text }}>{money(debt.totalBalance)}</span> remaining across {debt.count} debts</span>
                  <span><span style={{ ...NUMS, color: T.text }}>{debt.plan.months}</span> months to go</span>
                  <span>lifetime interest <span style={{ ...NUMS, color: T.text }}>{money(debt.plan.totalInterest)}</span></span>
                </div>
              </>
            ) : debt.totalBalance === 0 ? (
              // totalBalance, not count — paid-off debts are kept in the
              // array for history (see computeDashboard.ts), so count alone
              // stays nonzero even once every debt is actually cleared.
              <p className="text-2xl" style={SERIF}>No debts. Every dollar you earn already belongs to you. 🏁</p>
            ) : (
              <p className="text-sm" style={{ color: T.coral }}>{debt.plan?.warning ?? "Add balances and rates to project your debt-free date."}</p>
            )}
          </Panel>

          <Panel title={`Safety net · ${ef.targetMonths} months of essentials`}>
            <div className="flex items-baseline justify-between">
              <p className="text-4xl" style={{ ...SERIF, ...NUMS }}>
                {ef.coverageMonths.toFixed(1)}<span className="text-lg" style={{ color: T.mute }}> / {ef.targetMonths} months</span>
              </p>
              <span className="text-sm" style={{ ...NUMS, color: T.jade }}>{ef.pctFunded.toFixed(0)}%</span>
            </div>
            <div className="mt-3"><Bar pct={ef.pctFunded} color={T.jade} /></div>
            <p className="text-xs mt-3" style={{ color: T.mute }}>
              {money(ef.balance)} banked ·{" "}
              {ef.targetAmount <= 0
                ? "set your income to calculate a real target"
                : ef.remaining > 0 ? `${money(ef.remaining)} to a fully funded net` : "fully funded, exhale"}
            </p>
          </Panel>
        </div>

        {/* Row 3: Net worth */}
        {(() => {
          const nwColor = netWorth.tierColor === "jade" ? T.jade : netWorth.tierColor === "brass" ? T.brass : netWorth.tierColor === "coral" ? T.coral : T.mute;
          return (
            <Panel title="Net worth">
              <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
                <div>
                  <p className="text-5xl font-medium" style={{ ...SERIF, ...NUMS, color: netWorth.total >= 0 ? T.jade : T.coral }}>
                    {netWorth.total >= 0 ? "+" : ""}{money(netWorth.total)}
                  </p>
                  <span
                    className="inline-block mt-2 text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{ background: nwColor + "18", color: nwColor, border: `1px solid ${nwColor}40` }}
                  >
                    {netWorth.tier}
                  </span>
                </div>
                <div className="flex gap-6 text-right">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: T.mute }}>Assets</p>
                    <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color: T.jade }}>{money(netWorth.assets)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: T.mute }}>Liabilities</p>
                    <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color: netWorth.liabilities > 0 ? T.coral : T.mute }}>{money(netWorth.liabilities)}</p>
                  </div>
                </div>
              </div>

              {netWorthTrend.length >= 2 && (
                <div className="h-40 mb-2">
                  <ResponsiveContainer>
                    <LineChart data={netWorthTrend} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
                      <XAxis dataKey="ym" tickFormatter={ymStrLabel} tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} />
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

              <div className="space-y-2 pt-4" style={{ borderTop: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.mute }}>To grow your net worth</p>
                {netWorth.suggestions.map((s, i) => (
                  <p key={i} className="text-sm flex gap-2" style={{ color: i === 0 ? T.text : T.mute }}>
                    <span style={{ color: nwColor, flexShrink: 0 }}>→</span>
                    {s}
                  </p>
                ))}
              </div>
            </Panel>
          );
        })()}

        {/* Row 4: goals */}
        <Panel title="Goals & milestones">
          <div className="grid gap-4 sm:grid-cols-2">
            {goals.map((g) => (
              <div key={g.id} className="rounded-xl p-4" style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}>
                <div className="flex justify-between items-start gap-2">
                  <p className="font-medium">{g.emoji} {g.name}</p>
                  <span
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={{ border: `1px solid ${g.projection.onTrack ? T.jade : T.brass}`, color: g.projection.onTrack ? T.jade : T.brass }}
                  >
                    {g.projection.onTrack ? "on pace" : "needs a push"}
                  </span>
                </div>
                <div className="mt-3"><Bar pct={g.projection.pctComplete} color={T.brass} /></div>
                <div className="flex justify-between text-xs mt-2" style={{ color: T.mute }}>
                  <span style={NUMS}>{money(g.currentAmount)} of {money(g.targetAmount)}</span>
                  <span style={NUMS}>{g.projection.pctComplete.toFixed(0)}%</span>
                </div>
                <p className="text-xs mt-2" style={{ color: T.text }}>
                  <span style={{ ...NUMS, color: T.brass }}>{money(g.projection.requiredMonthly)}/mo</span> keeps this on schedule for {g.projection.targetDateDisplay}
                </p>
              </div>
            ))}
            {goals.length === 0 && (
              <p className="text-sm" style={{ color: T.mute }}>An empty canvas. Add your first milestone and the math starts working for you.</p>
            )}
          </div>
        </Panel>
      </div>
    </main>
  );
}
