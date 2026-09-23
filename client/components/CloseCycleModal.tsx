"use client";

import { useState } from "react";
import type { TrackedBalance, PeriodCloseAcknowledgement } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { MoneyInput, Label, FocusInput } from "./form/Primitives";
import { fmtCur, money } from "./screens/shared";

/** One account's state inside the dialog. */
export interface CloseRow {
  tb: TrackedBalance;
  /** The live `expected` figure for this account, captured before the close. */
  expectedAtClose: number;
  /**
   * This account's baseline is already NEWER than the cycle being closed, so
   * the close records its figures but does not reanchor it. Acknowledgement
   * is not offered either: the ack binds to startingAt plus the frozen
   * discrepancy, and with the baseline unchanged it would clear nothing.
   */
  recordedOnly?: boolean;
}

/**
 * The period-close dialog (docs/PERIOD_CLOSE_PLAN.md Phase 2).
 *
 * ONE confirm for every account. 2.4.86 requires the owner to state each
 * account individually -- that is why there is an amount field per row and
 * no "use my last figure" shortcut: a prefilled figure invites blind
 * confirmation, which is the auto-absorb this whole design refuses.
 *
 * The acknowledgement control appears only where there is a gap to explain,
 * and its note is REQUIRED (2.4.124). There is deliberately no bulk
 * "accept all": the per-account note is what makes acknowledging on a
 * schedule structurally impossible rather than merely discouraged.
 */
export default function CloseCycleModal({
  cycleLabel, rows, daysLate, rangeEnd, onCancel, onConfirm,
}: {
  cycleLabel: string;
  rows: CloseRow[];
  /** Whole days between the cycle end and now. 0 for the current cycle. */
  daysLate: number;
  /** The cycle's last day, already formatted. */
  rangeEnd: string;
  onCancel: () => void;
  onConfirm: (entries: { tb: TrackedBalance; actual: number; expectedAtClose: number; acknowledgement?: Omit<PeriodCloseAcknowledgement, "acknowledgedAt" | "startingAt"> }[]) => void;
}) {
  const T = useTheme();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const amountOf = (id: string) => parseFloat((amounts[id] ?? "").replace(/,/g, ""));
  const gapOf = (r: CloseRow) => {
    const a = amountOf(r.tb.id);
    return isNaN(a) ? null : Math.round((a - r.expectedAtClose) * 100) / 100;
  };
  /** The badge's own threshold: you can only explain a gap that is being flagged. */
  const hasGap = (r: CloseRow) => {
    if (r.recordedOnly) return false; // nothing to clear, so nothing to offer
    const g = gapOf(r);
    return g != null && Math.abs(g) >= 1;
  };

  const everyAmountEntered = rows.every((r) => !isNaN(amountOf(r.tb.id)));
  // A ticked acknowledgement with an empty or whitespace-only note blocks the
  // close. The note is the mechanism, not a label on it.
  const everyNoteFilled = rows.every((r) => !(acked[r.tb.id] && hasGap(r)) || (notes[r.tb.id] ?? "").trim().length > 0);
  const canClose = rows.length > 0 && everyAmountEntered && everyNoteFilled;

  function confirm() {
    if (!canClose) return;
    onConfirm(rows.map((r) => {
      const actual = amountOf(r.tb.id);
      const note = (notes[r.tb.id] ?? "").trim();
      const wants = acked[r.tb.id] && hasGap(r) && note.length > 0;
      return {
        tb: r.tb, actual, expectedAtClose: r.expectedAtClose,
        ...(wants ? { acknowledgement: { note, discrepancy: Math.round((actual - r.expectedAtClose) * 100) / 100 } } : {}),
      };
    }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: T.panel, border: `1px solid ${T.line}` }}
      >
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Close this cycle</p>
        <h2 className="text-lg mt-1 mb-1" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>{cycleLabel}</h2>
        <p className="text-xs mb-5" style={{ color: T.mute }}>
          State what each account actually holds. This sets its baseline to that figure, as of the
          cycle&apos;s last moment, so past drift stops affecting future checks.
          {daysLate > 0 && (
            <>
              {" "}Closing this <strong style={{ color: T.text }}>{daysLate} day{daysLate === 1 ? "" : "s"}</strong>{" "}
              after it ended &mdash; figures are compared against what the ledger expected on{" "}
              <strong style={{ color: T.text }}>{rangeEnd}</strong>, not today.
            </>
          )}
        </p>

        <div className="space-y-4">
          {rows.map((r) => {
            const gap = gapOf(r);
            const flagged = hasGap(r);
            return (
              <div key={r.tb.id} className="rounded-xl p-3.5 space-y-2" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: T.text }}>{r.tb.name}</span>
                  <span className="text-[10px]" style={{ color: T.mute }}>expected {money(r.expectedAtClose)}</span>
                </div>
                <Label htmlFor={`close-amt-${r.tb.id}`}>What {r.tb.name} actually holds</Label>
                <MoneyInput
                  id={`close-amt-${r.tb.id}`}
                  value={amounts[r.tb.id] ?? ""}
                  onChange={(v) => {
                    setAmounts((p) => ({ ...p, [r.tb.id]: v }));
                    // Editing the figure invalidates an acknowledgement made
                    // against the old one -- it was an explanation of a
                    // different number.
                    setAcked((p) => ({ ...p, [r.tb.id]: false }));
                  }}
                  placeholder="What you actually have"
                  max={Number.MAX_SAFE_INTEGER}
                />
                {r.recordedOnly && (
                  <p className="text-[10px]" style={{ color: T.brass }}>
                    Recorded only. Your baseline for this account is already later than this cycle,
                    so closing will not move it backwards.
                  </p>
                )}
                {gap != null && !r.recordedOnly && (
                  <p className="text-[10px]" style={{ color: flagged ? T.coral : T.jade }}>
                    {flagged
                      ? `Gap: ${fmtCur(Math.abs(gap), r.tb.currency)} unaccounted for.`
                      : "Matches what you logged."}
                  </p>
                )}
                {flagged && (
                  <div className="space-y-2 pt-1">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        aria-label="Mark this gap as accounted for"
                        checked={!!acked[r.tb.id]}
                        onChange={(e) => setAcked((p) => ({ ...p, [r.tb.id]: e.target.checked }))}
                      />
                      <span className="text-[11px]" style={{ color: T.mute }}>Mark this gap as accounted for</span>
                    </label>
                    {acked[r.tb.id] && (
                      <div>
                        <Label htmlFor={`ack-note-${r.tb.id}`}>What explains it? (required)</Label>
                        <FocusInput
                          id={`ack-note-${r.tb.id}`}
                          value={notes[r.tb.id] ?? ""}
                          onChange={(e) => setNotes((p) => ({ ...p, [r.tb.id]: e.target.value }))}
                          placeholder="e.g. cash withdrawal I never logged"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={confirm}
            disabled={!canClose}
            className="flex-1 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40"
            style={{ background: T.jade, color: T.ink }}
          >
            Close cycle
          </button>
          <button onClick={onCancel} className="px-3 py-2.5 rounded-xl text-sm hover:opacity-70" style={{ color: T.mute }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
