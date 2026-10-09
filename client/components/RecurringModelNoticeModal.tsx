"use client";

import { useRef } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useDialogFocus } from "./useDialogFocus";

/**
 * Shown once, the first time this ships to an account that went through the
 * Phase 2.5 migration (has any recurring item with a confirmCutoverDate --
 * never true for a brand-new account). Informational, not destructive --
 * unlike RecoveryCodeModal, a single dismiss is enough, no checkbox gate.
 */
export default function RecurringModelNoticeModal({
  outstandingCount,
  onDismiss,
}: {
  outstandingCount: number;
  onDismiss: () => void;
}) {
  const T = useTheme();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef); // A11Y-02: a named modal dialog, focus in and back

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurring-notice-title"
        className="w-full max-w-sm rounded-2xl p-7 shadow-2xl"
        style={{ background: T.panel, border: `1px solid ${T.line}` }}
      >
        <p id="recurring-notice-title" className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.brass }}>
          Recurring bills, updated
        </p>
        <h2 className="text-lg mt-1 mb-3" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
          They count once confirmed, not automatically
        </h2>
        <p className="text-xs mb-5" style={{ color: T.mute }}>
          Recurring bills now count once you confirm them, not automatically
          {outstandingCount > 0
            ? ` — you have ${outstandingCount} to confirm.`
            : "."}
          {" "}Your history before today is unaffected.
        </p>

        <button
          onClick={onDismiss}
          className="w-full py-3 rounded-xl text-sm font-semibold tracking-wide transition-all hover:opacity-90 active:scale-95"
          style={{ background: T.jade, color: T.ink }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
