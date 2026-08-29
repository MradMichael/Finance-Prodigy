"use client";

import { useState } from "react";
import type { LocalFinancials, StoredGoal } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, DateFieldDMY } from "./form/Primitives";

/**
 * Shared edit surface for a goal -- opened from InputPanel's Manage tab and
 * from GoalsScreen alike (usability backlog, 2026-08-29; see EditDebtSheet's
 * own comment for why this isn't an independent implementation per screen).
 * Ported verbatim from InputPanel's former inline edit-goal form.
 */
export default function EditGoalSheet({
  goal, financials, onChange, onClose,
}: {
  goal: StoredGoal;
  financials: LocalFinancials;
  onChange: (updated: LocalFinancials) => void;
  onClose: () => void;
}) {
  const T = useTheme();
  const update = (patch: Partial<LocalFinancials>) => onChange({ ...financials, ...patch });

  const [name,    setName]    = useState(goal.name);
  const [emoji,   setEmoji]   = useState(goal.emoji);
  const [target,  setTarget]  = useState(String(goal.targetAmount));
  const [current, setCurrent] = useState(String(goal.currentAmount));
  const [date,    setDate]    = useState(goal.targetDate);

  function save() {
    const targetNum  = parseFloat(target.replace(/,/g, ""));
    const currentNum = parseFloat(current.replace(/,/g, "")) || 0;
    // target <= 0 would read as 100%/achieved everywhere else that displays
    // this goal -- a $0 target isn't a real goal, same guard the add-goal
    // form already applies.
    if (!name.trim() || isNaN(targetNum) || targetNum <= 0 || !date) return;
    update({
      goals: financials.goals.map((g) => g.id !== goal.id ? g : {
        ...g, name: name.trim(), emoji: emoji || "🎯",
        targetAmount: targetNum, currentAmount: currentNum, targetDate: date,
        achievedAt: currentNum >= targetNum ? (g.achievedAt ?? new Date().toISOString()) : undefined,
      }),
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: T.panel, border: `1px solid ${T.line}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Edit goal</p>
          <button onClick={onClose} aria-label="Close" className="text-lg leading-none" style={{ color: T.mute }}>✕</button>
        </div>

        <div className="space-y-2.5">
          <div className="flex gap-2">
            <div style={{ width: 68 }}>
              <Label htmlFor="edit-goal-emoji">Emoji</Label>
              <FocusInput id="edit-goal-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
            </div>
            <div className="flex-1">
              <Label htmlFor="edit-goal-name">Name</Label>
              <FocusInput id="edit-goal-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="edit-goal-target">Target ({goal.currency === "LBP" ? "L£" : "$"})</Label><MoneyInput id="edit-goal-target" value={target} onChange={setTarget} placeholder="0" /></div>
            <div><Label htmlFor="edit-goal-saved">Saved ({goal.currency === "LBP" ? "L£" : "$"})</Label><MoneyInput id="edit-goal-saved" value={current} onChange={setCurrent} placeholder="0" /></div>
          </div>
          <div>
            <Label htmlFor="edit-goal-date">Target date</Label>
            <DateFieldDMY id="edit-goal-date" value={date} onChange={setDate} />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={save} className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>Save</button>
          <button onClick={onClose} className="px-3 py-2 rounded-xl text-sm hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
