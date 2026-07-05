"use client";

import { useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import type { computeDashboard } from "../../lib/computeDashboard";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, money } from "./shared";

export default function GoalsScreen({
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
