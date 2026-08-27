"use client";

import { useState } from "react";
import type { LocalFinancials, PaymentMethod, StoredCard } from "../../lib/localData";
import { uid, todayISO, roundMoney, buildGoalContributionTx, toUSD as toUSDShared, activeTransactions, DEFAULT_LBP_RATE } from "../../lib/localData";
import type { computeDashboard } from "../../lib/computeDashboard";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, money, fmtCur } from "./shared";
import { PaymentMethodPicker } from "../form/Primitives";

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
  // Phase 2.6.4: this screen's own, separate goal-contribution form (2.4.41
  // -- buildGoalContributionTx used to hardcode paymentMethod "other" here
  // too, found while designing the fix: InputPanel.tsx's inline
  // contributeToGoal is NOT the only entry point for this same builder).
  const [payMethod,    setPayMethod]    = useState<PaymentMethod>("cash");
  const [payCardId,    setPayCardId]    = useState<string | null>(null);
  const [payOtherNote, setPayOtherNote] = useState("");

  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const prefix = todayISO().slice(0, 7);
  const goalTxThisMonth = activeTransactions(financials.transactions ?? []).filter(
    (t) => t.bucket === "SAVINGS" && t.date.startsWith(prefix) && t.description.startsWith("Goal:")
  );
  // Converted per-transaction before summing -- a contribution is always
  // in its own goal's currency (see buildGoalContributionTx), so this sum
  // is mixed-currency the moment any goal is LBP, not just a display nit.
  const totalPaidThisMonth = goalTxThisMonth.reduce((s, t) => s + toUSDShared(t.amount, t.currency, lbpRate), 0);

  // Parameterized like InputPanel.tsx's own saveCard (Phase 2.6.4) -- this
  // screen owns financials.cards/onChange independently, so it needs its
  // own persistence call, but the same shape lets it share
  // PaymentMethodPicker without that component needing to know which
  // screen it's rendering in.
  function saveCard(type: StoredCard["type"], last4: string): StoredCard | null {
    if (last4.length !== 4 || !/^\d{4}$/.test(last4)) return null;
    const card: StoredCard = { id: uid(), type, last4, label: `${type} •••• ${last4}` };
    onChange({ ...financials, cards: [...financials.cards, card] });
    return card;
  }

  function pay(dashGoalId: number) {
    const amt = parseFloat(payAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;

    const rawGoal = financials.goals[dashGoalId - 1];
    if (!rawGoal) return;

    const updated = financials.goals.map((g) => {
      if (g.id !== rawGoal.id) return g;
      const newAmount = roundMoney(g.currentAmount + amt);
      return {
        ...g,
        currentAmount: newAmount,
        achievedAt: newAmount >= g.targetAmount
          ? (g.achievedAt ?? new Date().toISOString().slice(0, 10))
          : g.achievedAt,
      };
    });
    let cardId: string | undefined;
    let cardLabel: string | undefined;
    if (payMethod === "card" && payCardId) {
      const card = financials.cards.find((c) => c.id === payCardId);
      if (card) { cardId = card.id; cardLabel = card.label; }
    }
    const tx = buildGoalContributionTx(rawGoal, amt, lbpRate, {
      paymentMethod: payMethod, cardId, cardLabel,
      paymentNote: payMethod === "other" && payOtherNote.trim() ? payOtherNote.trim() : undefined,
    });
    onChange({ ...financials, goals: updated, transactions: [tx, ...(financials.transactions ?? [])] });
    setPaySuccess(dashGoalId);
    setPayGoalId(null);
    setPayAmt("");
    setPayMethod("cash"); setPayCardId(null); setPayOtherNote("");
    setTimeout(() => setPaySuccess(null), 3000);
  }

  // Pausing excludes the goal from the health score's goal-pace average and
  // Projections' funding plan while keeping it (and its saved amount) around
  // for history -- resuming is fully reversible. See computeDashboard.ts's
  // goalScores / ProjectionsScreen's openGoals for where paused is read.
  function togglePause(dashGoalId: number) {
    const rawGoal = financials.goals[dashGoalId - 1];
    if (!rawGoal) return;
    onChange({
      ...financials,
      goals: financials.goals.map((g) =>
        g.id !== rawGoal.id ? g : { ...g, pausedAt: g.pausedAt ? undefined : new Date().toISOString() }
      ),
    });
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
            <p className="text-sm" style={{ color: T.mute }}>No goals yet. Add one in My Finances.</p>
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
                    transition: "border-color 0.4s, opacity 0.4s",
                    opacity: g.paused ? 0.6 : 1,
                  }}
                >
                  <div className="p-5">
                    {/* Title + badge */}
                    <div className="flex items-start justify-between gap-2 mb-5">
                      <p className="text-base font-medium leading-snug" style={{ color: T.text }}>
                        {g.emoji} {g.name}
                        {pct >= 100 && <span className="ml-2 text-sm">✓</span>}
                      </p>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => togglePause(g.id)}
                          aria-label={g.paused ? "Resume goal" : "Pause goal"}
                          title={g.paused ? "Resume this goal" : "Pause this goal — won't count toward pace/score until resumed"}
                          className="text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap transition-all hover:opacity-80"
                          style={{ border: `1px solid ${T.mute}50`, color: T.mute }}
                        >
                          {g.paused ? "▶ resume" : "⏸ pause"}
                        </button>
                        <span
                          className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ border: `1px solid ${g.paused ? T.mute : color}`, color: g.paused ? T.mute : color }}
                        >
                          {g.paused ? "paused" : pct >= 100 ? "achieved!" : g.projection.onTrack ? "on pace" : "needs push"}
                        </span>
                      </div>
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
                          <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color: T.text }}>{fmtCur(g.currentAmount, g.currency)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>Target</p>
                          <p className="text-sm tabular-nums" style={{ color: T.mute }}>{fmtCur(g.targetAmount, g.currency)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>Left</p>
                          <p className="text-sm tabular-nums font-medium" style={{ color: remaining > 0 ? T.brass : T.jade }}>{fmtCur(remaining, g.currency)}</p>
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
                      <span><span style={{ color }}>{fmtCur(suggested, g.currency)}/mo</span> needed</span>
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
                          <p className="text-xs font-medium" style={{ color: T.jade }}>Payment added, great work!</p>
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
                                  {fmtCur(qa, g.currency)}
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
                                {fmtCur(suggested, g.currency)} target
                              </button>
                            </div>
                          )}

                          {/* Custom amount */}
                          <div className="flex gap-2">
                            <input
                              type="number" min="0" step="1"
                              placeholder={`Custom amount (${g.currency === "LBP" ? "L£" : "$"})`}
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
                              aria-label="Cancel contribution"
                              className="px-3 py-2 rounded-xl text-xs transition-all hover:opacity-70"
                              style={{ color: T.mute }}
                            >
                              ✕
                            </button>
                          </div>
                          <PaymentMethodPicker
                            value={payMethod}
                            onChange={setPayMethod}
                            cardId={payCardId}
                            onCardIdChange={setPayCardId}
                            otherNote={payOtherNote}
                            onOtherNoteChange={setPayOtherNote}
                            cards={financials.cards}
                            onSaveCard={saveCard}
                          />
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
