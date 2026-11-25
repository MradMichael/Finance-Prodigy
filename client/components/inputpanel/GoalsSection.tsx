"use client";

// InputPanel split, S9 (session 55): My Finances' Goals section, moved here line for line. The section's header
// (title and count) stays in InputPanel; a closed section doesn't build this at all.
import { useState } from "react";
import type { LocalFinancials, Currency, PaymentMethod, StoredCard } from "../../lib/localData";
import { buildNewGoal, goalProgress, goalAchievement, goalPercent, todayISO, fmtDate, lbpRateOf, edited, recordDeletion, moneyMaxFor, cardRef, applyGoalContribution } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { fmtCur } from "../screens/shared";
import FutureDateNote from "../form/FutureDateNote";
import { Label, FocusInput, MoneyInput, PrimaryBtn, CurrencyToggle, DateFieldDMY, PaymentMethodPicker } from "../form/Primitives";
import { looksLikeMistypedLbp } from "../../lib/entryGuards";

/** Goals: its form's state. InputPanel calls this, so the state lives there and what is typed survives closing the section, as before the move. */
export function useGoalsForm() {
  // Goal form
  const [gName,    setGName]    = useState("");
  const [gEmoji,   setGEmoji]   = useState("🎯");
  const [gTarget,  setGTarget]  = useState("");
  const [gCurrent, setGCurrent] = useState("");
  const [gDate,    setGDate]    = useState("");
  const [gCurrency, setGCurrency] = useState<Currency>("USD");
  // Goal contribution state
  const [contributeGoalId,  setContributeGoalId]  = useState<string | null>(null);
  const [contributeGoalAmt, setContributeGoalAmt] = useState("");
  // Phase 2.6.4: closes half of 2.4.41 -- buildGoalContributionTx used to
  // hardcode paymentMethod "other" unconditionally.
  const [contributeMethod, setContributeMethod] = useState<PaymentMethod>("cash");
  const [contributeCardId, setContributeCardId] = useState<string | null>(null);
  const [contributeOtherNote, setContributeOtherNote] = useState("");
  // 2.4.47: date defaults to today but is editable, same gap as the
  // debt-payment form.
  const [contributeDate, setContributeDate] = useState(todayISO());
  return { gName, setGName, gEmoji, setGEmoji, gTarget, setGTarget, gCurrent, setGCurrent, gDate, setGDate, gCurrency, setGCurrency, contributeGoalId, setContributeGoalId, contributeGoalAmt, setContributeGoalAmt, contributeMethod, setContributeMethod, contributeCardId, setContributeCardId, contributeOtherNote, setContributeOtherNote, contributeDate, setContributeDate };
}

export default function GoalsSection({ financials, update, lbpRate, cards, saveCard, showToast, onEdit, form, setLbpConfirm }: {
  financials: LocalFinancials;
  update: (patch: Partial<LocalFinancials>) => void;
  lbpRate: number;
  cards: StoredCard[];
  saveCard: (type: StoredCard["type"], last4: string) => StoredCard | null;
  showToast: (msg: string) => void;
  onEdit: (kind: "goal", id: string) => void;
  form: ReturnType<typeof useGoalsForm>;
  /** Item 3 (session 57): the panel's lira check, with a goal payment's words. */
  setLbpConfirm: (v: { amount: number; proceed: () => void; forGoal?: boolean } | null) => void;
}) {
  const T = useTheme();
  const { gName, setGName, gEmoji, setGEmoji, gTarget, setGTarget, gCurrent, setGCurrent, gDate, setGDate, gCurrency, setGCurrency, contributeGoalId, setContributeGoalId, contributeGoalAmt, setContributeGoalAmt, contributeMethod, setContributeMethod, contributeCardId, setContributeCardId, contributeOtherNote, setContributeOtherNote, contributeDate, setContributeDate } = form;

  function addGoal() {
    if (!gName.trim() || !gTarget || !gDate) return;
    // S4 (session 55): the record is built by buildNewGoal (localData.ts), shared with the Wishlist.
    const goal = buildNewGoal({
      name: gName.trim(), emoji: gEmoji || "🎯",
      targetAmount: parseFloat(gTarget.replace(/,/g, "")),
      openingAmount: parseFloat(gCurrent.replace(/,/g, "")) || 0,
      currency: gCurrency, targetDate: gDate,
    }, lbpRateOf(financials));
    update({ goals: [...financials.goals, edited(goal)] });
    setGName(""); setGTarget(""); setGCurrent(""); setGDate(""); setGEmoji("🎯"); setGCurrency("USD");
  }

  // Item 3 (owner, session 57): a lira goal's amount under L£500 asks first, as Goals' Add payment does (it never did
  // here). "Let me fix the amount" pays nothing; "No, save it as … LBP" pays.
  function contributeToGoal(goalId: string) {
    const amt = parseFloat(contributeGoalAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    const goal = financials.goals.find((g) => g.id === goalId);
    if (!goal) return;
    if (looksLikeMistypedLbp(amt, goal.currency)) { setLbpConfirm({ amount: amt, forGoal: true, proceed: () => commitContribution(goalId, amt) }); return; }
    commitContribution(goalId, amt);
  }

  function commitContribution(goalId: string, amt: number) {
    const goal = financials.goals.find((g) => g.id === goalId);
    if (!goal) return; // needed for the toast message below; applyGoalContribution does its own lookup for the actual update
    const { cardId, cardLabel } = cardRef(cards, contributeMethod, contributeCardId);
    // AUD-05: shared with GoalsScreen.tsx's pay() -- one implementation of
    // "what happens when you contribute to a goal," not two independently
    // maintained copies (2334ea9 already proved that split lets a real bug
    // land on only one side).
    const result = applyGoalContribution(financials.goals, goalId, amt, lbpRateOf(financials), {
      paymentMethod: contributeMethod, cardId, cardLabel,
      paymentNote: contributeMethod === "other" && contributeOtherNote.trim() ? contributeOtherNote.trim() : undefined,
      date: contributeDate || todayISO(),
    }, financials.transactions);
    if (!result) return;
    update({ goals: result.goals, transactions: [result.transaction, ...financials.transactions] });
    setContributeGoalId(null); setContributeGoalAmt("");
    setContributeMethod("cash"); setContributeCardId(null); setContributeOtherNote("");
    setContributeDate(todayISO());
    showToast(`Contribution added to ${goal.name}`);
  }

  // Pausing stops the goal counting toward the health score's goal-pace
  // average and Projections' funding plan (see computeDashboard.ts's
  // goalScores / ProjectionsScreen's openGoals) while keeping it, and its
  // saved amount, around for history -- resuming (clearing pausedAt) is
  // fully reversible. (A debt's "paid off" isn't stored at all since DI-01,
  // session 30: it's derived from its balance, debtPayoff.)
  function toggleGoalPause(goalId: string) {
    update({
      goals: financials.goals.map((g) => g.id !== goalId ? g : edited({
        ...g, pausedAt: g.pausedAt ? undefined : new Date().toISOString(),
      })),
    });
  }

  return (
    <>
      {financials.goals.map((g) => {
        // Matches computeDashboard.ts's own convention exactly (targetAmount
        // of exactly 0 reads as met, not 0%) -- this used to disagree with
        // every other goal display (GoalsScreen, FinancialDashboard, all of
        // which read dashData.goals) for a goal edited down to a $0 target.
        const saved = goalProgress(g, financials);
        const pct = g.targetAmount > 0 ? Math.min(100, (saved / g.targetAmount) * 100) : 100;
        // Phase 2.8.3: achieved, its date and the percent shown follow the one
        // rule (goalAchievement, goalPercent), as every other goal screen does.
        const achievement = goalAchievement(g, financials);
        const pctShown = goalPercent(saved, g.targetAmount, achievement.achieved);
        const remaining = Math.max(0, g.targetAmount - saved);
        const isContrib  = contributeGoalId === g.id;
        return (
          <div key={g.id}>
            <div
              className="rounded-xl px-3 py-2.5 group"
              style={{ background: T.panelSoft, border: `1px solid ${T.line}` }} // item 1 (session 59): no fade when paused; the "Paused" badge says it
            >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm flex items-center gap-1.5 min-w-0" style={{ color: T.text }}>
                      <span className="truncate">{g.emoji} {g.name}</span>
                      {achievement.achieved && (
                        <span className="flex-shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: T.jade + "22", color: T.jade }}>Achieved</span>
                      )}
                      {g.pausedAt && (
                        <span className="flex-shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: T.mute + "22", color: T.mute }}>Paused</span>
                      )}
                    </p>
                    <p className="text-[10px] tabular-nums mt-0.5" style={{ color: T.mute }}>
                      {fmtCur(saved, g.currency)} of {fmtCur(g.targetAmount, g.currency)}
                      {remaining > 0 && <span style={{ color: T.brass }}> · {fmtCur(remaining, g.currency)} to go</span>}
                    </p>
                    {(g.createdAt || achievement.on || g.pausedAt) && (
                      <p className="text-[9px] mt-0.5" style={{ color: T.mute }}>
                        {g.createdAt && <span>Added {fmtDate(g.createdAt)}</span>}
                        {achievement.on && <span style={{ color: T.jade }}> · Achieved {fmtDate(achievement.on)}</span>}
                        {g.pausedAt && <span> · Paused {fmtDate(g.pausedAt)}</span>}
                      </p>
                    )}
                  </div>
                  {/* Item 2 (owner, session 58): the 70% fading moved from this row to its three icon-only buttons (the
                      same look, hover included: 70%, 56% on hover), so "+add", 10 px text, reaches 4.5:1 in every
                      theme at full strength. TODO 133 (session 66): "+add" has no hover fade either; at 80% it fell
                      to 4.07 in Ivory and 4.30 in Aurora when hovered. */}
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => onEdit("goal", g.id)}
                      aria-label="Edit goal"
                      className="text-[10px] px-1.5 py-0.5 rounded transition-all opacity-70 hover:opacity-[0.56]"
                      style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                    >✎</button>
                    <button
                      onClick={() => toggleGoalPause(g.id)}
                      aria-label={g.pausedAt ? "Resume goal" : "Pause goal"}
                      title={g.pausedAt ? "Resume this goal" : "Pause this goal — won't count toward pace/score until resumed"}
                      className="text-[10px] px-1.5 py-0.5 rounded transition-all opacity-70 hover:opacity-[0.56]"
                      style={{ color: g.pausedAt ? T.jade : T.mute, border: `1px solid ${g.pausedAt ? T.jade : T.mute}40` }}
                    >{g.pausedAt ? "▶" : "⏸"}</button>
                    <button
                      onClick={() => { setContributeGoalId(isContrib ? null : g.id); setContributeGoalAmt(""); setContributeDate(todayISO()); }}
                      aria-label="Add to this goal"
                      className="text-[10px] px-1.5 py-0.5 rounded transition-all"
                      style={{ color: T.jade, border: `1px solid ${T.jade}40` }}
                    >+add</button>
                    <button
                      onClick={() => { if (confirm("Delete this goal?")) update({ goals: financials.goals.filter((x) => x.id !== g.id), deletedKeys: recordDeletion(financials, "goals", g.id) }); }}
                      aria-label="Delete goal"
                      className="text-xs opacity-70"
                      style={{ color: T.coral }}
                    >✕</button>
                  </div>
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: T.line }}>
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: achievement.achieved ? T.jade : T.brass }} />
                </div>
                <div className="flex justify-between text-[9px] mt-1">
                  <span style={{ color: achievement.achieved ? T.jade : T.brass }}>{pctShown}%</span>
                  <span style={{ color: T.mute }}>by {fmtDate(g.targetDate)}</span>
                </div>
              </div>
            {isContrib && (
              <div className="mt-1 rounded-xl p-3 space-y-2" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>
                  Add to this goal
                </p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <MoneyInput value={contributeGoalAmt} onChange={setContributeGoalAmt} placeholder="Amount" max={moneyMaxFor(g.currency, lbpRate)} />
                  </div>
                  <button
                    onClick={() => contributeToGoal(g.id)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
                    style={{ background: T.jade, color: T.ink }}
                  >Save</button>
                  <button onClick={() => setContributeGoalId(null)} aria-label="Cancel contribution" className="px-2 py-1.5 rounded-xl text-xs" style={{ color: T.mute }}>✕</button>
                </div>
                <div>
                  <Label htmlFor={`contribute-date-${g.id}`}>Date paid</Label>
                  <DateFieldDMY id={`contribute-date-${g.id}`} value={contributeDate} onChange={setContributeDate} />
                  <FutureDateNote date={contributeDate} />
                </div>
                <PaymentMethodPicker
                  value={contributeMethod}
                  onChange={setContributeMethod}
                  cardId={contributeCardId}
                  onCardIdChange={setContributeCardId}
                  otherNote={contributeOtherNote}
                  onOtherNoteChange={setContributeOtherNote}
                  cards={cards}
                  onSaveCard={saveCard}
                />
                <p className="text-[10px]" style={{ color: T.mute }}>Logged as a Savings transaction.</p>
              </div>
            )}
          </div>
        );
      })}

      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: T.ink, border: `1px solid ${T.line}` }}
      >
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.brass }}>
          New goal
        </p>
        <div className="flex gap-2">
          <div style={{ width: 68 }}>
            <Label htmlFor="new-goal-emoji">Emoji</Label>
            <FocusInput id="new-goal-emoji" value={gEmoji} onChange={(e) => setGEmoji(e.target.value)} />
          </div>
          <div className="flex-1">
            <Label htmlFor="new-goal-name">Name</Label>
            <FocusInput id="new-goal-name" value={gName} onChange={(e) => setGName(e.target.value)} placeholder="Travel fund…" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="new-goal-target">Target ({gCurrency === "LBP" ? "L£" : "$"})</Label>
            <MoneyInput id="new-goal-target" value={gTarget} onChange={setGTarget} placeholder="5,000" max={moneyMaxFor(gCurrency, lbpRate)} />
          </div>
          <div>
            <Label htmlFor="new-goal-saved">Saved ({gCurrency === "LBP" ? "L£" : "$"})</Label>
            <MoneyInput id="new-goal-saved" value={gCurrent} onChange={setGCurrent} placeholder="0" max={moneyMaxFor(gCurrency, lbpRate)} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label htmlFor="new-goal-date">Target date</Label>
            <DateFieldDMY id="new-goal-date" value={gDate} onChange={setGDate} />
          </div>
          <div>
            <Label>Currency</Label>
            <CurrencyToggle value={gCurrency} onChange={setGCurrency} />
          </div>
        </div>
        <PrimaryBtn onClick={addGoal} color={T.brass} disabled={!gName.trim() || !gTarget || !gDate}>+ Add goal</PrimaryBtn>
      </div>
    </>
  );
}
