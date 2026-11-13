"use client";

import { useRef } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useDialogFocus } from "./useDialogFocus";

/**
 * "Is this lira amount really USD?" (session 42, owner-approved item 2), asked when a lira amount is under
 * LBP_MISTYPE_THRESHOLD (lib/entryGuards.ts). R7 (session 51 review; InputPanel split, step S2): written once
 * here; it was written out in InputPanel and in EditTransactionSheet.
 *
 * `amount` is the lira figure as typed (LBP, native). `onFix` closes it ("Let me fix the currency", a tap
 * outside, and Escape where `closeOnEscape` is set: the entry form sets it, the edit sheet doesn't, as each did
 * before). `onSave` closes it and goes ahead.
 */
export default function LbpMistypeDialog({ amount, onFix, onSave, closeOnEscape = false }: {
  amount: number;
  onFix: () => void;
  onSave: () => void;
  closeOnEscape?: boolean;
}) {
  const T = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, true); // A11Y-02
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onFix(); }}
      onKeyDown={closeOnEscape ? (e) => { if (e.key === "Escape") onFix(); } : undefined}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm low LBP amount"
        className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
        style={{ background: T.panel, border: `1px solid ${T.line}` }}
      >
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: T.brass }}>Double-check this amount</p>
        <p className="text-sm mb-5" style={{ color: T.text }}>
          <strong>{amount.toLocaleString("en-US")} LBP</strong> is unusually low for a real purchase — most things this cheap are actually meant to be USD. Did you mean to log this in USD instead?
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onFix}
            className="w-full py-2.5 rounded-xl text-sm font-semibold hover:opacity-90"
            style={{ background: T.jade, color: T.ink }}
          >
            Let me fix the currency
          </button>
          <button
            onClick={onSave}
            className="w-full py-2.5 rounded-xl text-sm hover:opacity-90"
            style={{ background: T.panelSoft, color: T.mute, border: `1px solid ${T.line}` }}
          >
            No, save it as {amount.toLocaleString("en-US")} LBP
          </button>
        </div>
      </div>
    </div>
  );
}
