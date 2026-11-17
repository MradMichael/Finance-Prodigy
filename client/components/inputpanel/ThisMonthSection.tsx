"use client";

// InputPanel split, S11 (session 55): My Finances' This month section, moved here line for line. The section's
// header (title and count) stays in InputPanel, and so does "Show all" (so it isn't forgotten when the section
// is closed) and the list's scroll-focus ref.
import type { LocalFinancials, StoredCard, StoredRecurring, StoredTransaction, cycleStartDayOf } from "../../lib/localData";
import { FREQ_LABELS, cycleMonthDivergence } from "../../lib/localData";
import type { periodNoun } from "../../lib/period";
import { useTheme } from "../../contexts/ThemeContext";
import { fmtCur } from "../screens/shared";
import type { useScrollFocus } from "../useScrollFocus";
import EntryRow from "./EntryRow";

export default function ThisMonthSection({ financials, cards, monthTx, recurRowsThisMonth, noun, startDay, TX_BUCKETS, PHONE_MONTH_ROWS, showAllMonth, setShowAllMonth, monthListScrollRef, totalOut, fmt, logAgain, onEdit, softDeleteTransaction }: {
  financials: LocalFinancials;
  cards: StoredCard[];
  monthTx: StoredTransaction[];
  recurRowsThisMonth: { r: StoredRecurring; usd: number }[];
  noun: ReturnType<typeof periodNoun>;
  startDay: ReturnType<typeof cycleStartDayOf>;
  TX_BUCKETS: { value: string; label: string; icon: string; color: string }[];
  PHONE_MONTH_ROWS: number;
  showAllMonth: boolean;
  setShowAllMonth: (v: boolean) => void;
  monthListScrollRef: ReturnType<typeof useScrollFocus>;
  totalOut: number;
  fmt: (n: number) => string;
  logAgain: (t: StoredTransaction) => void;
  onEdit: (kind: "transaction", id: string) => void;
  softDeleteTransaction: (txId: string) => void;
}) {
  const T = useTheme();

  return (
    <>
      {monthTx.length === 0 && recurRowsThisMonth.length === 0 ? (
        <div
          className="rounded-xl px-4 py-6 text-center"
          style={{ background: T.panelSoft, border: `1px dashed ${T.line}` }}
        >
          <p className="text-2xl mb-1">📭</p>
          <p className="text-xs" style={{ color: T.mute }}>No entries yet this {noun}</p>
        </div>
      ) : (
        <>
          <div ref={monthListScrollRef} className="space-y-2 md:max-h-72 md:overflow-y-auto pr-0.5" /* U6 (session 33): grows on a phone, a box from md up */>
            {monthTx.map((tx, i) => {
              // Safe again now that TRANSFER is a real TX_BUCKETS member
              // (2.4.55 sub-phase 3) -- the ?? TRANSFER_META fallback
              // this replaced (2.4.56) is no longer reachable.
              const b = TX_BUCKETS.find((b) => b.value === tx.bucket)!;
              const divergence = cycleMonthDivergence(tx, financials.recurring ?? [], startDay);
              return (
                <div key={tx.id} data-month-entry data-entry-row className={!showAllMonth && i >= PHONE_MONTH_ROWS ? "max-md:hidden" : undefined}>
                    <EntryRow variant="month" tx={tx} b={b} divergence={divergence} financials={financials} cards={cards} logAgain={logAgain} onEdit={onEdit} softDeleteTransaction={softDeleteTransaction} />
                </div>
              );
            })}
            {recurRowsThisMonth.map(({ r, usd }) => {
              const b = TX_BUCKETS.find((bb) => bb.value === r.bucket)!;
              return (
                <div
                  key={`recur-${r.id}`}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5"
                  style={{ background: T.panelSoft, borderLeft: `3px solid ${b.color}`, opacity: 0.85 }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm flex-shrink-0">↻</span>
                    <div className="min-w-0">
                      <span className="text-xs truncate block" style={{ color: T.text }}>{r.emoji ? `${r.emoji} ` : ""}{r.name}</span>
                      <span className="text-[9px]" style={{ color: T.mute }}>Recurring · {FREQ_LABELS[r.frequency]}</span>
                    </div>
                  </div>
                  <span className="text-xs font-semibold tabular-nums flex-shrink-0" style={{ color: b.color }}>
                    {fmtCur(usd, "USD")}
                  </span>
                </div>
              );
            })}
          </div>
          {!showAllMonth && monthTx.length > PHONE_MONTH_ROWS && (
            <button
              onClick={() => setShowAllMonth(true)}
              className="md:hidden w-full text-xs font-semibold px-3 py-2 rounded-xl hover:opacity-90"
              style={{ background: T.panelSoft, color: T.text, border: `1px solid ${T.line}` }}
            >
              Show all
            </button>
          )}
          <div
            className="flex justify-between text-xs px-3 py-2 rounded-xl"
            style={{ background: T.ink, color: T.mute }}
          >
            <span>
              {monthTx.length} {monthTx.length === 1 ? "entry" : "entries"}
              {recurRowsThisMonth.length > 0 && ` + ${recurRowsThisMonth.length} recurring`}
            </span>
            <span className="font-semibold tabular-nums" style={{ color: T.text }}>{fmt(totalOut)} logged</span>
          </div>
        </>
      )}
    </>
  );
}
