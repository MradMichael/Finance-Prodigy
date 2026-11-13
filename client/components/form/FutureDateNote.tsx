"use client";

import { useTheme } from "../../contexts/ThemeContext";
import { todayISO } from "../../lib/localData";

/**
 * SESSION 47 PLANS item 5 (owner, session 47, LB1 question 2): a goal contribution dated in the future counts
 * toward its goal as soon as it's entered. This line says so, under the date, while the date is after today (the
 * device's local day, todayISO: TIME-02). It doesn't block the save and stores nothing. Wording: a DRAFT, held
 * for the owner's approval.
 */
export default function FutureDateNote({ date }: { date: string }) {
  const T = useTheme();
  if (!date || date <= todayISO()) return null;
  return (
    <p className="text-[11px] mt-1" style={{ color: T.brass }} aria-live="polite">
      That date is in the future. It counts toward this goal now.
    </p>
  );
}
