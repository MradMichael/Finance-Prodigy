"use client";

import { useState } from "react";
import { toUSD, moneyMaxFor, type Currency, type TrackedBalance, type PeriodCloseAcknowledgement } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { MoneyInput, Label, FocusInput } from "./form/Primitives";
import { fmtCur } from "./screens/shared";

/**
 * Phase 5a: an adjustment-based row -- the emergency fund, or one debt.
 *
 * Rendered beside the tracked balances but behaving differently, and the
 * difference is deliberate rather than incidental:
 *
 *   * PRE-FILLED with `expected`. The app already knows the derived figure,
 *     so an unchanged account is confirmed by leaving it alone. A tracked
 *     balance cannot do this -- a reanchor always writes -- which is what
 *     keeps the close from getting longer in proportion to the accounts.
 *   * NO acknowledgement. The ack suppresses the Mismatch badge, and these
 *     accounts have no badge to suppress. A control that does nothing
 *     visible is worse than no control (2.4.134).
 *
 * `expected` is in `currency`: USD for the fund, the debt's own currency
 * for a debt. Nothing here converts.
 */
export interface AdjustmentRow {
  /** "ef", or the debt's id. */
  key: string;
  name: string;
  currency: Currency;
  expected: number;
  /** Why the figure is asked for differently -- a debt is read, not counted. */
  hint: string;
}

/** One account's state inside the dialog. */
export interface CloseRow {
  tb: TrackedBalance;
  /**
   * The `expected` figure for this account as of the close, captured before
   * it. USD -- trackedBalanceExpectedAsOf converts the starting balance and
   * every transaction. The row renders it in the its own currency,
   * because the input beside it is native.
   */
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
  cycleLabel, rows, adjustmentRows, daysLate, rangeEnd, reopenable, lbpRateAtClose, onCancel, onConfirm,
}: {
  cycleLabel: string;
  rows: CloseRow[];
  /** Whole days between the cycle end and now. 0 for the current cycle. */
  daysLate: number;
  /** The cycle's last day, already formatted. */
  rangeEnd: string;
  /**
   * Whether the cycle being closed is the CURRENT one, and so reopenable.
   * Passed in rather than inferred from daysLate === 0: a past cycle closed
   * on the very day it ended is also 0 days late and is NOT reopenable, so
   * that inference would promise an undo this dialog cannot deliver.
   */
  reopenable: boolean;
  /**
   * The LBP rate in force for the cycle being closed, chosen by the screen
   * (rateForMonth against the closing key, not the live rate -- a late
   * close states a balance as of the cycle end). One rate, passed in, used
   * for every conversion this dialog does and for the figure it hands back.
   * Choosing it is policy and lives with the screen; applying it is
   * mechanical and lives here.
   */
  lbpRateAtClose: number;
  /** Phase 5a. Empty when the owner has neither a fund nor an open debt. */
  adjustmentRows: AdjustmentRow[];
  onCancel: () => void;
  onConfirm: (
    entries: { tb: TrackedBalance; actual: number; actualUSD: number; expectedAtClose: number; acknowledgement?: Omit<PeriodCloseAcknowledgement, "acknowledgedAt" | "startingAt"> }[],
    /** Phase 5a, in each row's own currency. The screen plans the adjustments. */
    adjustments: { key: string; counted: number }[],
  ) => void;
}) {
  const T = useTheme();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // Pre-filled from the derived figure, so an unchanged row is confirmed by
  // not touching it. Seeded once at mount rather than defaulted at read
  // time, so clearing the field is an edit the user can see and correct,
  // not a silent snap back to the app's own number.
  const [adjAmounts, setAdjAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(adjustmentRows.map((r) => [r.key, String(r.expected)])),
  );
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const amountOf = (id: string) => parseFloat((amounts[id] ?? "").replace(/,/g, ""));
  const round2 = (x: number) => Math.round(x * 100) / 100;

  // THREE figures, and keeping them apart is the whole of this fix.
  //
  //   the typed amount   NATIVE  -- it becomes startingBalance
  //   expectedAtClose    USD     -- the ledger converts everything
  //   the stored gap     USD     -- comparable across accounts, and what
  //                                 acknowledgementFor matches against
  //
  // Everything the dialog COMPARES is USD and is labelled USD; the only
  // native figure is the input, and its label names the unit. Rendering the
  // expectation in the account currency instead was tried and dropped: it
  // means multiplying the rounded USD figure back up, and 111.73 x 89,500
  // is 9,999,835 rather than the 10,000,000 baseline it came from. A figure
  // visibly 165 lira off its own source invites exactly the question the
  // row exists to answer.
  // Rounded HERE, once. The threshold, the acknowledgement and the stored
  // record all read this same figure, so they cannot differ by a rounding
  // step -- and a reader can check the record arithmetic by eye, which is
  // the property a record that disagreed with the screen never had.
  const actualUSDOf = (r: CloseRow) => round2(toUSD(amountOf(r.tb.id), r.tb.currency, lbpRateAtClose));

  /** What the row prints, what the threshold uses, what the record stores. */
  const gapUSDOf = (r: CloseRow) => {
    const a = amountOf(r.tb.id);
    return isNaN(a) ? null : round2(actualUSDOf(r) - r.expectedAtClose);
  };
  /** The badge's own threshold: you can only explain a gap that is being flagged. */
  const hasGap = (r: CloseRow) => {
    if (r.recordedOnly) return false; // nothing to clear, so nothing to offer
    const g = gapUSDOf(r);
    return g != null && Math.abs(g) >= 1;
  };


  const adjOf = (key: string) => parseFloat((adjAmounts[key] ?? "").replace(/,/g, ""));
  const everyAmountEntered =
    rows.every((r) => !isNaN(amountOf(r.tb.id)))
    && adjustmentRows.every((r) => !isNaN(adjOf(r.key)));
  // A ticked acknowledgement with an empty or whitespace-only note blocks the
  // close. The note is the mechanism, not a label on it.
  const everyNoteFilled = rows.every((r) => !(acked[r.tb.id] && hasGap(r)) || (notes[r.tb.id] ?? "").trim().length > 0);
  // Phase 5a: a close is possible with NO tracked balances, if there is a
  // fund or a debt to state. The old `rows.length > 0` was the tracked-only
  // assumption in its last remaining place.
  const canClose = (rows.length > 0 || adjustmentRows.length > 0) && everyAmountEntered && everyNoteFilled;

  function confirm() {
    if (!canClose) return;
    onConfirm(rows.map((r) => {
      const actual = amountOf(r.tb.id);
      const note = (notes[r.tb.id] ?? "").trim();
      const wants = acked[r.tb.id] && hasGap(r) && note.length > 0;
      return {
        tb: r.tb, actual, actualUSD: actualUSDOf(r), expectedAtClose: r.expectedAtClose,
        // The SAME USD figure the threshold used. acknowledgementFor
        // matches this against balanceChecks[].discrepancy, which is USD;
        // a native figure here never matches, so the note is stored and the
        // badge it was written to clear stays lit. Nothing errors -- the
        // control silently does nothing.
        ...(wants ? { acknowledgement: { note, discrepancy: gapUSDOf(r)! } } : {}),
      };
    }),
    adjustmentRows.map((r) => ({ key: r.key, counted: adjOf(r.key) })),
    );
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
          {reopenable && (
            <>
              {" "}You can reopen this cycle while it is still current.
            </>
          )}
        </p>

        <div className="space-y-4">
          {rows.map((r) => {
            const gap = gapUSDOf(r);
            const flagged = hasGap(r);
            return (
              <div key={r.tb.id} className="rounded-xl p-3.5 space-y-2" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: T.text }}>{r.tb.name}</span>
                  <span className="text-[10px]" style={{ color: T.mute }}>expected {fmtCur(r.expectedAtClose, "USD")}</span>
                </div>
                <Label htmlFor={`close-amt-${r.tb.id}`}>What {r.tb.name} actually holds ({r.tb.currency === "LBP" ? "L£" : "$"})</Label>
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
                  max={moneyMaxFor(r.tb.currency, lbpRateAtClose)}
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
                      ? `Gap: ${fmtCur(Math.abs(gap), "USD")} unaccounted for.`
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

          {/* Phase 5a: the fund and any open debt. Pre-filled, no
              acknowledgement, and a zero delta writes nothing -- so a row
              that is already right costs one glance, not one typed figure. */}
          {adjustmentRows.map((r) => {
            const entered = adjOf(r.key);
            const delta = isNaN(entered) ? null : Math.round((entered - r.expected) * 100) / 100;
            return (
              <div key={r.key} className="rounded-xl p-3.5 space-y-2" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: T.text }}>{r.name}</span>
                  <span className="text-[10px]" style={{ color: T.mute }}>on record {fmtCur(r.expected, r.currency)}</span>
                </div>
                <Label htmlFor={`close-adj-${r.key}`}>
                  {r.hint} ({r.currency === "LBP" ? "L£" : "$"})
                </Label>
                <MoneyInput
                  id={`close-adj-${r.key}`}
                  value={adjAmounts[r.key] ?? ""}
                  onChange={(v) => setAdjAmounts((p) => ({ ...p, [r.key]: v }))}
                  placeholder={String(r.expected)}
                  max={moneyMaxFor(r.currency, lbpRateAtClose)}
                />
                <p className="text-[10px]" style={{ color: delta ? T.coral : T.mute }}>
                  {delta == null
                    ? "Enter a figure, or leave the one on record."
                    : delta === 0
                      ? "Matches what is on record. Nothing will be written."
                      : `Records an adjustment of ${fmtCur(Math.abs(delta), r.currency)} ${delta > 0 ? "up" : "down"}.`}
                </p>
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
