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
  ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis,
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

// ----------------------------- theme ----------------------------- //
const T = {
  ink: "#0B1F1E", panel: "#11302C", panelSoft: "#16403A", line: "#1E4A43",
  text: "#EAF2EF", mute: "#8FAFA7",
  brass: "#E3B341", jade: "#4FD1A5", coral: "#F08A7E", sky: "#7FB8D8",
};
const SERIF: React.CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };
const NUMS: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

const money = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(n);
const ymLabel = (ymKey: number) => {
  const m = ymKey % 100, y = Math.floor(ymKey / 100) % 100;
  return `${["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m]} ’${y}`;
};

// ----------------------------- types ----------------------------- //
interface Projection {
  pctComplete: number; monthsRemaining: number; requiredMonthly: number;
  paceRatio: number; onTrack: boolean; targetDateDisplay: string;
}
interface DashboardPayload {
  user: { name: string; currency: string; payoffStrategy: "SNOWBALL" | "AVALANCHE" };
  period: { year: number; month: number };
  health: {
    score: number; grade: string;
    components: { key: string; label: string; score: number; weight: number; detail: string }[];
  };
  encouragements: string[];
  month: {
    income: number; needsSpend: number; wantsSpend: number; savingsContrib: number;
    totalSpend: number; netCashFlow: number; savingsRatePct: number;
  };
  emergencyFund: {
    targetMonths: number; targetAmount: number; balance: number;
    coverageMonths: number; pctFunded: number; remaining: number;
  };
  debt: {
    totalBalance: number; count: number;
    plan: {
      feasible: boolean; months: number; debtFreeDateDisplay: string | null;
      totalInterest: number; monthlyCommitment: number; warning?: string;
    } | null;
  };
  goals: {
    id: number; name: string; emoji: string | null; type: string;
    targetAmount: number; currentAmount: number; projection: Projection;
  }[];
  sixMonthTrend: { ymKey: number; income: number; spend: number }[];
}

// ------------------------- mock (dev only) ------------------------ //
const MOCK: DashboardPayload = {
  user: { name: "Demo User", currency: "USD", payoffStrategy: "AVALANCHE" },
  period: { year: 2026, month: 6 },
  health: {
    score: 68, grade: "Building momentum",
    components: [
      { key: "savings", label: "Savings rate", score: 72, weight: 25, detail: "14% of income saved (target 20%)" },
      { key: "needs", label: "Needs discipline", score: 88, weight: 20, detail: "Essentials take 47% of income (target ≤50%)" },
      { key: "ef", label: "Safety net", score: 52, weight: 25, detail: "Emergency fund 52% funded" },
      { key: "debt", label: "Debt pressure", score: 61, weight: 20, detail: "Debt payments are 19% of income" },
      { key: "goals", label: "Goal momentum", score: 81, weight: 10, detail: "Average pace across active goals" },
    ],
  },
  encouragements: [
    "Your safety net is 52% built. Past halfway — the rest is downhill.",
    "Stay the course and you're debt-free by 14-09-2028 — the date is already on the calendar.",
    "30 Before 30 Travel Fund is on pace — 31% there.",
  ],
  month: { income: 3500, needsSpend: 1640, wantsSpend: 710, savingsContrib: 480, totalSpend: 2830, netCashFlow: 670, savingsRatePct: 13.7 },
  emergencyFund: { targetMonths: 6, targetAmount: 9840, balance: 5120, coverageMonths: 3.1, pctFunded: 52, remaining: 4720 },
  debt: {
    totalBalance: 13260, count: 3,
    plan: { feasible: true, months: 27, debtFreeDateDisplay: "14-09-2028", totalInterest: 1684, monthlyCommitment: 675 },
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
};

// --------------------------- data hook --------------------------- //
function useDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(setData)
      .catch(() => { setData(MOCK); setDemo(true); });
  }, []);
  return { data, demo };
}

// --------------------------- sub-views --------------------------- //

function HealthRing({ score, grade }: { score: number; grade: string }) {
  const ringColor = score >= 80 ? T.jade : score >= 50 ? T.brass : T.coral;
  return (
    <div className="relative h-44 w-44 mx-auto">
      <ResponsiveContainer>
        <RadialBarChart
          data={[{ value: score }]} innerRadius="78%" outerRadius="100%"
          startAngle={225} endAngle={-45}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={12} fill={ringColor} background={{ fill: T.line }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl" style={{ ...SERIF, ...NUMS, color: T.text }}>{score}</span>
        <span className="text-xs tracking-widest uppercase mt-1" style={{ color: ringColor }}>{grade}</span>
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: T.line }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

function BucketRow({ label, actual, target, color }: { label: string; actual: number; target: number; color: string }) {
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
        {headroom >= 0 ? `${money(headroom)} of room left` : `${money(-headroom)} over — next month resets the line`}
      </p>
    </div>
  );
}

function Panel({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl p-5 ${className}`} style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      {title && <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: T.mute }}>{title}</h2>}
      {children}
    </section>
  );
}

// ---------------------------- screen ----------------------------- //

export default function FinancialDashboard() {
  const { data, demo } = useDashboard();

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: T.ink, color: T.mute }}>
        Counting your wins…
      </div>
    );
  }

  const { health, month, emergencyFund: ef, debt, goals, sixMonthTrend, encouragements, user, period } = data;
  const monthName = ["", "January","February","March","April","May","June","July","August","September","October","November","December"][period.month];
  const targets = {
    needs: month.income * 0.5,
    wants: month.income * 0.3,
    savings: month.income * 0.2,
  };

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink, color: T.text }}>
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Momentum · {monthName} {period.year}</p>
            <h1 className="text-3xl md:text-4xl mt-1" style={SERIF}>
              {month.netCashFlow >= 0
                ? <>You kept <span style={{ color: T.brass }}>{money(month.netCashFlow)}</span> this month, {user.name.split(" ")[0]}.</>
                : <>A heavy month — the plan below absorbs it, {user.name.split(" ")[0]}.</>}
            </h1>
          </div>
          {demo && (
            <span className="text-xs px-3 py-1 rounded-full" style={{ border: `1px solid ${T.line}`, color: T.mute }}>
              demo data — API offline
            </span>
          )}
        </header>

        {/* Encouragements */}
        <div className="rounded-2xl px-5 py-4 space-y-1.5" style={{ background: T.panelSoft, borderLeft: `3px solid ${T.brass}` }}>
          {encouragements.map((e, i) => (
            <p key={i} className="text-sm" style={{ color: i === 0 ? T.text : T.mute }}>{e}</p>
          ))}
        </div>

        {/* Row 1: health · 50/30/20 · trend */}
        <div className="grid gap-6 md:grid-cols-3">
          <Panel title="Financial health">
            <HealthRing score={health.score} grade={health.grade} />
            <div className="mt-4 space-y-2.5">
              {health.components.map((c) => (
                <div key={c.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: T.mute }}>{c.label}</span>
                    <span style={{ ...NUMS, color: T.text }}>{c.score}</span>
                  </div>
                  <Bar pct={c.score} color={c.score >= 70 ? T.jade : c.score >= 40 ? T.brass : T.coral} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="The 50 / 30 / 20 split">
            <div className="space-y-5">
              <BucketRow label="Needs · 50%" actual={month.needsSpend} target={targets.needs} color={T.sky} />
              <BucketRow label="Wants · 30%" actual={month.wantsSpend} target={targets.wants} color={T.brass} />
              <BucketRow label="Savings · 20%" actual={month.savingsContrib} target={targets.savings} color={T.jade} />
            </div>
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
              The gap between the lines is your monthly progress.
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
            ) : debt.count === 0 ? (
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
              {money(ef.balance)} banked · {ef.remaining > 0 ? `${money(ef.remaining)} to a fully funded net` : "fully funded — exhale"}
            </p>
          </Panel>
        </div>

        {/* Row 3: goals */}
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
              <p className="text-sm" style={{ color: T.mute }}>An empty canvas — add your first milestone and the math starts working for you.</p>
            )}
          </div>
        </Panel>
      </div>
    </main>
  );
}
