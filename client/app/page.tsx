"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import FinancialDashboard from "../components/FinancialDashboard";
import InputPanel from "../components/InputPanel";
import { loadData, saveData, monthlyEquivalent, fmtDate, FREQ_LABELS, BUDGET_RULES } from "../lib/localData";
import type { LocalFinancials, BudgetRuleKey } from "../lib/localData";
import { computeDashboard } from "../lib/computeDashboard";
import { getSession, signOut } from "../lib/auth";
import type { Session } from "../lib/auth";
import { pushToServer, getLastSyncTime } from "../lib/syncService";
import { useTheme } from "../contexts/ThemeContext";
import { Signet } from "../components/EssaBrand";

type SyncStatus = "idle" | "syncing" | "synced" | "offline";

type Screen = "overview" | "budget" | "setup" | "finances" | "transactions" | "goals" | "debts" | "recurring";

const NAV: { key: Screen; label: string; icon: string }[] = [
  { key: "overview",     label: "Overview",     icon: "◉" },
  { key: "budget",       label: "Budget",       icon: "◫" },
  { key: "setup",        label: "Setup",        icon: "⚙" },
  { key: "finances",     label: "My Finances",  icon: "✎" },
  { key: "transactions", label: "Transactions", icon: "≡" },
  { key: "goals",        label: "Goals",        icon: "◎" },
  { key: "debts",        label: "Debts",        icon: "⌁" },
  { key: "recurring",    label: "Recurring",    icon: "↻" },
];

const SERIF: React.CSSProperties = { fontFamily: "Spectral, Georgia, serif" };
const NUMS:  React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const money  = (n: number, d = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d }).format(n);

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTIONS SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function TransactionsScreen({ financials }: { financials: LocalFinancials }) {
  const T = useTheme();
  const [filter, setFilter] = useState("all");

  const lbpRate = financials.lbpRate ?? 89500;
  const toUSD   = (n: number, cur?: string) => cur === "LBP" ? n / lbpRate : n;

  const allTx  = [...financials.transactions].sort((a, b) => b.date.localeCompare(a.date));
  const months = Array.from(new Set(allTx.map((t) => t.date.slice(0, 7)))).sort().reverse();
  const filtered = filter === "all" ? allTx : allTx.filter((t) => t.date.startsWith(filter));

  const fmtMo = (ym: string) => {
    const [y, m] = ym.split("-");
    return `${["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m]} ${y}`;
  };
  const grouped = filtered.reduce<Record<string, typeof allTx>>((acc, t) => {
    const k = t.date.slice(0, 7);
    (acc[k] = acc[k] ?? []).push(t);
    return acc;
  }, {});
  const BC = { NEEDS: T.sky, WANTS: T.brass, SAVINGS: T.jade } as const;
  const BL = { NEEDS: "Needs", WANTS: "Wants", SAVINGS: "Savings" } as const;

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
            <h1 className="text-3xl mt-1" style={SERIF}>Transactions</h1>
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm"
            style={{ background: T.panel, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
          >
            <option value="all">All time</option>
            {months.map((m) => <option key={m} value={m}>{fmtMo(m)}</option>)}
          </select>
        </div>

        {/* Bucket summary */}
        <div className="grid grid-cols-3 gap-3">
          {(["NEEDS","WANTS","SAVINGS"] as const).map((b) => {
            const sum = filtered.filter((t) => t.bucket === b).reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
            return (
              <div key={b} className="rounded-2xl px-4 py-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.mute }}>{BL[b]}</p>
                <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color: BC[b] }}>{money(sum)}</p>
              </div>
            );
          })}
        </div>

        {/* List by month */}
        {Object.keys(grouped).sort().reverse().map((mo) => {
          const txs = grouped[mo];
          const moTotal = txs.reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
          return (
            <div key={mo}>
              <div className="flex justify-between items-baseline mb-2 px-1">
                <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>{fmtMo(mo)}</p>
                <p className="text-xs tabular-nums" style={{ color: T.mute }}>{money(moTotal)}</p>
              </div>
              <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.line}` }}>
                {txs.map((t, i) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{ background: T.panel, borderTop: i > 0 ? `1px solid ${T.line}` : undefined }}
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: BC[t.bucket] }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: T.text }}>{t.description}</p>
                      <p className="text-[10px]" style={{ color: T.mute }}>
                        {fmtDate(t.date)} · {BL[t.bucket]}
                        {t.cardLabel
                          ? ` · ${t.cardLabel}`
                          : t.paymentMethod === "cash"
                          ? " · Cash"
                          : t.paymentMethod === "other"
                          ? t.paymentNote ? ` · 🤝 ${t.paymentNote}` : " · Other"
                          : ""}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium tabular-nums" style={{ color: BC[t.bucket] }}>{money(toUSD(t.amount, t.currency))}</p>
                      {t.currency === "LBP" && (
                        <p className="text-[10px]" style={{ color: T.mute }}>LBP {t.amount.toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="text-sm" style={{ color: T.mute }}>No transactions yet — add them in My Finances.</p>
          </div>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GOALS SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function GoalsScreen({
  dashData,
  financials,
  onChange,
}: {
  dashData:   ReturnType<typeof computeDashboard>;
  financials: LocalFinancials;
  onChange:   (f: LocalFinancials) => void;
}) {
  const T     = useTheme();
  const goals = dashData.goals;

  const [payGoalId,  setPayGoalId]  = useState<number | null>(null);
  const [payAmt,     setPayAmt]     = useState("");
  const [paySuccess, setPaySuccess] = useState<number | null>(null);

  const prefix = new Date().toISOString().slice(0, 7);
  const goalTxThisMonth = (financials.transactions ?? []).filter(
    (t) => t.bucket === "SAVINGS" && t.date.startsWith(prefix) && t.description.startsWith("Goal:")
  );
  const totalPaidThisMonth = goalTxThisMonth.reduce((s, t) => s + t.amount, 0);

  function pay(dashGoalId: number) {
    const amt = parseFloat(payAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;

    const rawGoal = financials.goals[dashGoalId - 1];
    if (!rawGoal) return;

    const updated = financials.goals.map((g) =>
      g.id !== rawGoal.id ? g : {
        ...g,
        currentAmount: g.currentAmount + amt,
        achievedAt: g.currentAmount + amt >= g.targetAmount
          ? (g.achievedAt ?? new Date().toISOString().slice(0, 10))
          : g.achievedAt,
      }
    );
    const tx = {
      id: Math.random().toString(36).slice(2, 10),
      amount: amt, currency: "USD" as const, bucket: "SAVINGS" as const,
      description: `Goal: ${rawGoal.name}`,
      date: new Date().toISOString().slice(0, 10),
      paymentMethod: "other" as const,
    };
    onChange({ ...financials, goals: updated, transactions: [tx, ...(financials.transactions ?? [])] });
    setPaySuccess(dashGoalId);
    setPayGoalId(null);
    setPayAmt("");
    setTimeout(() => setPaySuccess(null), 3000);
  }

  const healthGoalComponent = dashData.health.components.find((c) => c.key === "goals");

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
            <h1 className="text-3xl mt-1" style={SERIF}>Goals</h1>
          </div>
          {totalPaidThisMonth > 0 && (
            <div className="rounded-xl px-4 py-2.5 flex items-center gap-2" style={{ background: T.jade + "18", border: `1px solid ${T.jade}35` }}>
              <span className="text-lg">🔥</span>
              <div>
                <p className="text-xs font-semibold" style={{ color: T.jade }}>{money(totalPaidThisMonth)} paid toward goals this month</p>
                <p className="text-[10px]" style={{ color: T.mute }}>{goalTxThisMonth.length} payment{goalTxThisMonth.length !== 1 ? "s" : ""} logged</p>
              </div>
            </div>
          )}
        </div>

        {/* Health score for goals */}
        {healthGoalComponent && (
          <div className="rounded-2xl px-5 py-4 flex items-center justify-between gap-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Goal momentum · health impact</p>
              <p className="text-sm mt-1" style={{ color: T.mute }}>{healthGoalComponent.detail}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-2xl font-bold tabular-nums" style={{ color: healthGoalComponent.score >= 70 ? T.jade : healthGoalComponent.score >= 40 ? T.brass : T.coral }}>
                {healthGoalComponent.score}
              </p>
              <p className="text-[10px]" style={{ color: T.mute }}>/ 100</p>
            </div>
          </div>
        )}

        {goals.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-2xl mb-2">🎯</p>
            <p className="text-sm" style={{ color: T.mute }}>No goals yet — add one in My Finances.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {goals.map((g) => {
              const pct      = g.projection.pctComplete;
              const color    = g.projection.onTrack ? T.jade : T.brass;
              const r        = 38;
              const circ     = 2 * Math.PI * r;
              const dash     = (pct / 100) * circ;
              const isPaying = payGoalId === g.id;
              const isSuccess = paySuccess === g.id;
              const remaining = Math.max(0, g.targetAmount - g.currentAmount);
              const suggested = g.projection.requiredMonthly;
              const quickAmts = [
                Math.round(suggested * 0.5 / 5) * 5,
                Math.round(suggested / 5) * 5,
                Math.round(suggested * 1.5 / 5) * 5,
              ].filter((v, i, a) => v > 0 && a.indexOf(v) === i);

              return (
                <div
                  key={g.id}
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: T.panel,
                    border: `1px solid ${isSuccess ? T.jade : T.line}`,
                    transition: "border-color 0.4s",
                  }}
                >
                  <div className="p-5">
                    {/* Title + badge */}
                    <div className="flex items-start justify-between gap-2 mb-5">
                      <p className="text-base font-medium leading-snug" style={{ color: T.text }}>
                        {g.emoji} {g.name}
                        {pct >= 100 && <span className="ml-2 text-sm">✓</span>}
                      </p>
                      <span
                        className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                        style={{ border: `1px solid ${color}`, color }}
                      >
                        {pct >= 100 ? "achieved!" : g.projection.onTrack ? "on pace" : "needs push"}
                      </span>
                    </div>

                    {/* Ring + numbers */}
                    <div className="flex items-center gap-5">
                      <div className="relative w-24 h-24 flex-shrink-0">
                        <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: "rotate(-90deg)" }}>
                          <circle cx="50" cy="50" r={r} fill="none" stroke={T.line} strokeWidth="10" />
                          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
                            strokeDasharray={`${dash} ${circ - dash}`}
                            style={{ transition: "stroke-dasharray 0.8s ease" }}
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-sm font-bold tabular-nums" style={{ color: T.text }}>{pct}%</span>
                        </div>
                      </div>
                      <div className="space-y-2 flex-1 min-w-0">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>Saved</p>
                          <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color: T.text }}>{money(g.currentAmount)}</p>
                        </div>
                        <div className="flex gap-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>Target</p>
                            <p className="text-sm tabular-nums" style={{ color: T.mute }}>{money(g.targetAmount)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>Left</p>
                            <p className="text-sm tabular-nums font-medium" style={{ color: remaining > 0 ? T.brass : T.jade }}>{money(remaining)}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-4 h-1.5 rounded-full overflow-hidden" style={{ background: T.line }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(100, pct)}%`, background: color, transition: "width 0.8s ease" }}
                      />
                    </div>

                    {/* Timeline row */}
                    <div className="mt-3 flex flex-wrap gap-x-4 text-xs" style={{ color: T.mute }}>
                      <span><span style={{ color }}>{money(suggested)}/mo</span> needed</span>
                      <span>{g.projection.monthsRemaining} mo left</span>
                      <span>by {g.projection.targetDateDisplay}</span>
                    </div>
                  </div>

                  {/* Payment section */}
                  {pct < 100 && (
                    <div style={{ borderTop: `1px solid ${T.line}` }}>
                      {isSuccess ? (
                        <div className="px-5 py-3 flex items-center gap-2" style={{ background: T.jade + "14" }}>
                          <span>✓</span>
                          <p className="text-xs font-medium" style={{ color: T.jade }}>Payment added — great work!</p>
                        </div>
                      ) : !isPaying ? (
                        <button
                          onClick={() => { setPayGoalId(g.id); setPayAmt(""); }}
                          className="w-full px-5 py-3 text-xs font-semibold text-left flex items-center gap-2 transition-all hover:opacity-80"
                          style={{ color: T.jade }}
                        >
                          <span className="text-base">＋</span> Add payment
                        </button>
                      ) : (
                        <div className="px-5 py-4 space-y-3" style={{ background: T.panelSoft }}>
                          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Add payment</p>

                          {/* Quick amounts */}
                          {quickAmts.length > 0 && (
                            <div className="flex gap-2 flex-wrap">
                              {quickAmts.map((qa) => (
                                <button
                                  key={qa}
                                  onClick={() => setPayAmt(String(qa))}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                                  style={{
                                    background: payAmt === String(qa) ? T.jade + "22" : T.ink,
                                    border: `1px solid ${payAmt === String(qa) ? T.jade : T.line}`,
                                    color: payAmt === String(qa) ? T.jade : T.mute,
                                  }}
                                >
                                  {money(qa)}
                                </button>
                              ))}
                              <button
                                onClick={() => setPayAmt(String(suggested))}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                                style={{
                                  background: payAmt === String(suggested) ? T.jade + "22" : T.jade + "10",
                                  border: `1px solid ${T.jade}50`,
                                  color: T.jade,
                                }}
                              >
                                {money(suggested)} target
                              </button>
                            </div>
                          )}

                          {/* Custom amount */}
                          <div className="flex gap-2">
                            <input
                              type="number" min="0" step="1"
                              placeholder="Custom amount ($)"
                              value={payAmt}
                              onChange={(e) => setPayAmt(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && pay(g.id)}
                              className="flex-1 rounded-xl px-3 py-2 text-sm tabular-nums"
                              style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
                            />
                            <button
                              onClick={() => pay(g.id)}
                              disabled={!payAmt || parseFloat(payAmt) <= 0}
                              className="px-4 py-2 rounded-xl text-xs font-bold transition-all hover:opacity-90 disabled:opacity-40"
                              style={{ background: T.jade, color: T.ink }}
                            >
                              Pay
                            </button>
                            <button
                              onClick={() => { setPayGoalId(null); setPayAmt(""); }}
                              className="px-3 py-2 rounded-xl text-xs transition-all hover:opacity-70"
                              style={{ color: T.mute }}
                            >
                              ✕
                            </button>
                          </div>
                          <p className="text-[10px]" style={{ color: T.mute }}>
                            Logged as a Savings transaction · boosts your financial health score
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEBTS SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function DebtsScreen({ financials, dashData }: { financials: LocalFinancials; dashData: ReturnType<typeof computeDashboard> }) {
  const T = useTheme();
  const totalBal  = financials.debts.reduce((s, d) => s + d.balance, 0);
  const totalMin  = financials.debts.reduce((s, d) => s + d.minPayment, 0);
  const plan      = dashData.debt.plan;

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Debts</h1>
        </div>

        {financials.debts.length === 0 ? (
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
                    Avalanche saves {money(dashData.debt.comparison.avalancheSavesVsSnowball)} in interest over Snowball on this debt load — the tradeoff is fewer quick wins along the way.
                  </p>
                )}
              </div>
            )}

            {/* Individual debts */}
            <div className="space-y-3">
              {financials.debts.map((d) => {
                const monthlyInt = (d.apr / 100 / 12) * d.balance;
                return (
                  <div key={d.id} className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <p className="font-medium" style={{ color: T.text }}>{d.name}</p>
                      <p className="text-xl font-semibold tabular-nums flex-shrink-0" style={{ ...SERIF, color: T.coral }}>{money(d.balance)}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{ color: T.mute }}>
                      <span>APR <span style={{ color: T.text }}>{d.apr}%</span></span>
                      <span>Min payment <span style={{ color: T.text }}>{money(d.minPayment)}/mo</span></span>
                      <span>Monthly interest <span style={{ color: T.coral }}>{money(monthlyInt)}</span></span>
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

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function BudgetScreen({
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

  const targetPct = ruleKey === "custom"
    ? { needs: customNeeds, wants: customWants, savings: Math.max(0, 100 - customNeeds - customWants) }
    : { needs: BUDGET_RULES[ruleKey].needs, wants: BUDGET_RULES[ruleKey].wants, savings: BUDGET_RULES[ruleKey].savings };

  const targetAmt = {
    needs:   income * targetPct.needs   / 100,
    wants:   income * targetPct.wants   / 100,
    savings: income * targetPct.savings / 100,
  };

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
              Your needs are taking <strong style={{ color: T.text }}>{Math.round(actualNeedsPct)}%</strong> of income this month —
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
                const maxVal = Math.max(0, 100 - other);
                return (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span style={{ color: T.mute }}>{label}</span>
                      <span style={{ color: T.jade }}>{val}%</span>
                    </div>
                    <input
                      type="range" min={0} max={maxVal} step={5} value={Math.min(val, maxVal)}
                      onChange={(e) => onChange({ ...financials, [field]: parseInt(e.target.value) })}
                      className="w-full" style={{ accentColor: T.jade }}
                    />
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
                      ? `${money(-headroom)} over — consider trimming ${label.toLowerCase()} or switching to a looser model`
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
              The goal isn&apos;t to hit an arbitrary split — it&apos;s to keep essentials covered, avoid debt, and save
              whatever margin exists. The <strong style={{ color: T.text }}>Survival (80/15/5)</strong> model or
              <strong style={{ color: T.text }}> Custom</strong> mode let you set targets that actually reflect your reality.
            </p>
          </div>
        )}

      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function SetupScreen({
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
              onChange={(e) => update({ income: parseFloat(e.target.value) || 0 })}
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
              onChange={(e) => update({ lbpRate: parseFloat(e.target.value) || 89500 })}
              placeholder="89500"
            />
            <p className="text-[11px] mt-1.5 px-1" style={{ color: T.mute }}>
              Used to convert L£ amounts to $ across the app. Update this when the rate changes.
            </p>
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
                onChange={(e) => update({ emergencyFundTargetMonths: parseInt(e.target.value) || 6 })}
              />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: T.mute }}>Current balance ($)</label>
              <input
                className="w-full rounded-xl px-4 py-2.5 text-sm tabular-nums"
                style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
                type="number" min="0" step="100"
                value={financials.emergencyFundBalance || ""}
                onChange={(e) => update({ emergencyFundBalance: parseFloat(e.target.value) || 0 })}
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

// ─────────────────────────────────────────────────────────────────────────────
// RECURRING SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function RecurringScreen({ financials }: { financials: LocalFinancials }) {
  const T    = useTheme();
  const now  = new Date();
  const lbpRate = financials.lbpRate ?? 89500;
  const toUSD   = (n: number, cur?: string) => cur === "LBP" ? n / lbpRate : n;
  const BC   = { NEEDS: T.sky, WANTS: T.brass, SAVINGS: T.jade } as const;
  const BL   = { NEEDS: "Needs", WANTS: "Wants", SAVINGS: "Savings" } as const;

  const totalMonthly = financials.recurring.reduce((s, r) => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);

  const buckets = (["NEEDS","WANTS","SAVINGS"] as const).map((b) => ({
    bucket: b,
    items: financials.recurring.filter((r) => r.bucket === b),
    total: financials.recurring.filter((r) => r.bucket === b)
      .reduce((s, r) => s + toUSD(monthlyEquivalent(r, now), r.currency), 0),
  }));

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Recurring</h1>
        </div>

        {financials.recurring.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm" style={{ color: T.mute }}>No recurring items yet — add them in My Finances.</p>
          </div>
        ) : (
          <>
            {/* Total */}
            <div className="rounded-2xl px-5 py-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Total committed monthly</p>
              <p className="text-4xl font-medium tabular-nums mt-1" style={{ ...SERIF, color: T.text }}>{money(totalMonthly)}</p>
            </div>

            {/* By bucket */}
            {buckets.map(({ bucket, items, total }) => items.length > 0 && (
              <div key={bucket}>
                <div className="flex justify-between items-baseline mb-2 px-1">
                  <p className="text-xs uppercase tracking-widest" style={{ color: BC[bucket] }}>{BL[bucket]}</p>
                  <p className="text-xs tabular-nums" style={{ color: T.mute }}>{money(total)}/mo</p>
                </div>
                <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.line}` }}>
                  {items.map((r, i) => {
                    const monthly = toUSD(monthlyEquivalent(r, now), r.currency);
                    return (
                      <div
                        key={r.id}
                        className="flex items-center gap-3 px-4 py-3"
                        style={{ background: T.panel, borderTop: i > 0 ? `1px solid ${T.line}` : undefined }}
                      >
                        <span className="text-xl">{r.emoji}</span>
                        <div className="flex-1">
                          <p className="text-sm" style={{ color: T.text }}>{r.name}</p>
                          <p className="text-[10px]" style={{ color: T.mute }}>
                            {money(r.amount, 2)} · {FREQ_LABELS[r.frequency]}
                          </p>
                        </div>
                        <p className="text-sm font-medium tabular-nums" style={{ color: BC[bucket] }}>
                          {money(monthly)}/mo
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────
function SyncDot({ status }: { status: SyncStatus }) {
  const T = useTheme();
  if (status === "idle") return null;
  const cfg = {
    syncing: { color: T.brass,  label: "Syncing…",  animate: true  },
    synced:  { color: T.jade,   label: "Synced",     animate: false },
    offline: { color: T.mute,   label: "Offline",    animate: false },
  }[status];
  return (
    <span
      className="flex items-center gap-1"
      title={cfg.label}
      style={{ color: cfg.color }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{
          background: cfg.color,
          animation: cfg.animate ? "essa-spin 1s linear infinite" : undefined,
        }}
      />
    </span>
  );
}

const SIDEBAR_PIN_KEY = "essa_sidebar_pinned";

function Sidebar({
  screen, setScreen, session, onProfile, syncStatus,
}: {
  screen: Screen; setScreen: (s: Screen) => void;
  session: Session; onProfile: () => void;
  syncStatus: SyncStatus;
}) {
  const T = useTheme();
  const initials = session.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_PIN_KEY) === "1";
  });
  const [hovered, setHovered] = useState(false);

  const expanded = pinned || hovered;

  function togglePin(e: React.MouseEvent) {
    e.stopPropagation();
    setPinned((v) => {
      const next = !v;
      localStorage.setItem(SIDEBAR_PIN_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <aside
      className="hidden md:flex flex-col flex-shrink-0"
      style={{
        width: expanded ? 220 : 60,
        transition: "width 0.18s ease",
        background: T.panel,
        borderRight: `1px solid ${T.line}`,
        overflow: "hidden",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Logo + pin button */}
      <div
        className="flex items-center gap-2 px-3.5 flex-shrink-0"
        style={{ height: 56, borderBottom: `1px solid ${T.line}` }}
      >
        <div className="flex-shrink-0"><Signet size={26} /></div>
        {expanded && (
          <>
            <span className="text-sm font-semibold flex-1 whitespace-nowrap" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
              ESSA
            </span>
            <button
              onClick={togglePin}
              title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg transition-all hover:opacity-80"
              style={{
                color: pinned ? T.brass : T.mute,
                background: pinned ? T.brass + "18" : "transparent",
                border: `1px solid ${pinned ? T.brass + "40" : "transparent"}`,
                fontSize: 12,
              }}
            >
              {pinned ? "◈" : "◇"}
            </button>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-hidden">
        {NAV.map(({ key, label, icon }) => {
          const active = screen === key;
          return (
            <button
              key={key}
              onClick={() => setScreen(key)}
              className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                background: active ? T.brass + "1A" : "transparent",
                color: active ? T.brass : T.mute,
                whiteSpace: "nowrap",
              }}
            >
              <span className="text-base w-5 text-center flex-shrink-0">{icon}</span>
              {expanded && <span>{label}</span>}
            </button>
          );
        })}
      </nav>

      {/* User + sync indicator */}
      <div className="flex-shrink-0 px-2 py-3" style={{ borderTop: `1px solid ${T.line}` }}>
        <button
          onClick={onProfile}
          className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl transition-all hover:opacity-80"
          style={{ whiteSpace: "nowrap" }}
        >
          <div className="relative flex-shrink-0">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
              style={{ background: T.jade + "2A", color: T.jade }}
            >
              {initials}
            </div>
            {syncStatus !== "idle" && (
              <span
                className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border"
                style={{
                  background: syncStatus === "synced" ? T.jade : syncStatus === "syncing" ? T.brass : T.mute,
                  borderColor: T.panel,
                }}
              />
            )}
          </div>
          {expanded && (
            <div className="text-left overflow-hidden flex-1">
              <p className="text-xs font-medium truncate" style={{ color: T.text }}>{session.name}</p>
              <p className="text-[10px] truncate" style={{ color: T.mute }}>
                {syncStatus === "syncing" ? "Syncing…" : syncStatus === "synced" ? "Synced" : syncStatus === "offline" ? "Offline" : session.email}
              </p>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MOBILE BOTTOM TAB BAR
// ─────────────────────────────────────────────────────────────────────────────
function BottomNav({ screen, setScreen }: { screen: Screen; setScreen: (s: Screen) => void }) {
  const T = useTheme();
  return (
    <nav
      className="md:hidden flex items-center justify-around px-2 py-2 flex-shrink-0"
      style={{ background: T.panel, borderTop: `1px solid ${T.line}` }}
    >
      {NAV.map(({ key, label, icon }) => {
        const active = screen === key;
        return (
          <button
            key={key}
            onClick={() => setScreen(key)}
            className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all"
            style={{ color: active ? T.brass : T.mute }}
          >
            <span className="text-base leading-none">{icon}</span>
            <span className="text-[9px] font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP BAR (mobile header)
// ─────────────────────────────────────────────────────────────────────────────
function TopBar({ session, onProfile, onSignOut }: { session: Session; onProfile: () => void; onSignOut: () => void }) {
  const T        = useTheme();
  const [menu, setMenu] = useState(false);
  const initials = session.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <header
      className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 md:hidden"
      style={{ background: T.panel, borderBottom: `1px solid ${T.line}` }}
    >
      <div className="flex items-center gap-2">
        <Signet size={26} />
        <span className="text-sm font-semibold" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>ESSA</span>
      </div>
      <div className="relative">
        <button
          onClick={() => setMenu((v) => !v)}
          className="flex items-center gap-2 rounded-xl px-2.5 py-1.5"
          style={{ background: T.panelSoft }}
        >
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{ background: T.jade + "2A", color: T.jade }}>{initials}</div>
          <span className="text-[10px]" style={{ color: T.mute }}>▾</span>
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl py-2 z-20 shadow-2xl"
              style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <button onClick={() => { setMenu(false); onProfile(); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:opacity-80 flex gap-2" style={{ color: T.text }}>
                <span>⚙</span> Settings
              </button>
              <button onClick={() => { setMenu(false); onSignOut(); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:opacity-80 flex gap-2" style={{ color: T.coral }}>
                <span>→</span> Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME
// ─────────────────────────────────────────────────────────────────────────────
const SYNC_DEBOUNCE_MS = 2500; // wait 2.5 s after last change before pushing

export default function Home() {
  const router  = useRouter();
  const T       = useTheme();
  const [session,    setSession]    = useState<Session | null>(null);
  const [financials, setFinancials] = useState<LocalFinancials | null>(null);
  const [screen,     setScreen]     = useState<Screen>("overview");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");

  const syncTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef  = useRef<Session | null>(null);

  // keep a stable ref so the debounce closure always sees the latest session
  useEffect(() => { sessionRef.current = session; }, [session]);

  const autoSync = useCallback(async (data: LocalFinancials, email: string) => {
    setSyncStatus("syncing");
    const result = await pushToServer(email, data);
    setSyncStatus(result.ok ? "synced" : "offline");
    // fade back to idle after 4 s so the indicator doesn't stay forever
    setTimeout(() => setSyncStatus((s) => s !== "syncing" ? "idle" : s), 4000);
  }, []);

  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/sign-in"); return; }
    setSession(s);
    loadData(s.userId).then((data) => {
      setFinancials({ ...data, userName: s.name });
    });
  }, [router]);

  async function handleChange(updated: LocalFinancials) {
    if (!session) return;
    setFinancials(updated);
    await saveData(updated, session.userId);

    // Debounced auto-sync: reset the timer on every change
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setSyncStatus("idle"); // clear stale status while user is still typing
    syncTimer.current = setTimeout(() => {
      const s = sessionRef.current;
      if (s) autoSync(updated, s.email);
    }, SYNC_DEBOUNCE_MS);
  }

  function handleSignOut() {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    signOut();
    router.push("/sign-in");
  }
  function handleProfile() { router.push("/profile"); }

  const dashboardData = useMemo(() => (financials ? computeDashboard(financials) : null), [financials]);

  // Persist a monthly net-worth snapshot so the trend chart has history to
  // show. computeDashboard stays pure/side-effect-free — this is the one
  // place that writes the snapshot back, and only when it's actually stale
  // (new month, or this month's value changed), so it can't loop.
  useEffect(() => {
    if (!financials || !dashboardData) return;
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const history = financials.netWorthHistory ?? [];
    const existing = history.find((h) => h.ym === ym);
    if (existing?.value === dashboardData.netWorth.total) return;
    const updatedHistory = [...history.filter((h) => h.ym !== ym), { ym, value: dashboardData.netWorth.total }]
      .sort((a, b) => a.ym.localeCompare(b.ym))
      .slice(-12);
    handleChange({ ...financials, netWorthHistory: updatedHistory });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financials, dashboardData]);

  if (!session || !financials || !dashboardData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: T.ink }}>
        <Signet size={40} />
        <p className="text-sm" style={{ color: T.mute }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: T.ink }}>

      {/* Mobile header */}
      <TopBar session={session} onProfile={handleProfile} onSignOut={handleSignOut} />

      {/* Body row */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Desktop sidebar */}
        <Sidebar
          screen={screen} setScreen={setScreen}
          session={session} onProfile={handleProfile}
          syncStatus={syncStatus}
        />

        {/* Main content */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {screen === "overview"     && <FinancialDashboard data={dashboardData} />}
          {screen === "budget"       && <BudgetScreen financials={financials} dashData={dashboardData} onChange={handleChange} />}
          {screen === "setup"        && <SetupScreen financials={financials} onChange={handleChange} />}
          {screen === "finances"     && <InputPanel financials={financials} onChange={handleChange} session={session} />}
          {screen === "transactions" && <TransactionsScreen financials={financials} />}
          {screen === "goals"        && <GoalsScreen dashData={dashboardData} financials={financials} onChange={handleChange} />}
          {screen === "debts"        && <DebtsScreen financials={financials} dashData={dashboardData} />}
          {screen === "recurring"    && <RecurringScreen financials={financials} />}
        </div>

      </div>

      {/* Mobile bottom nav */}
      <BottomNav screen={screen} setScreen={setScreen} />
    </div>
  );
}
