"use client";

// InputPanel split, S11 (session 55): My Finances' History section, moved here line for line. The section's
// header (title and count) stays in InputPanel.
//
// R1 (session 32 review): History is built only while its Section is open. It used to build a row for every
// past entry on every render, closed, which cost 500 ms a render at 15,000 entries and 0.65 s per action on a
// mid-range phone at 1,500. InputPanel wrapped it in a small "BuiltWhenOpen" component for that; this
// component is that boundary now (a closed Section doesn't render its children, so this isn't called).
import type { LocalFinancials, StoredCard, StoredTransaction, cycleStartDayOf, makeToUSDOn } from "../../lib/localData";
import { cycleMonthDivergence } from "../../lib/localData";
import { cycleKeyForISO, cycleLabel, type CycleKey } from "../../lib/period";
import { totalSpent } from "../../lib/spending";
import { useTheme } from "../../contexts/ThemeContext";
import EntryRow from "./EntryRow";

export default function HistorySection({ financials, cards, pastTx, startDay, TX_BUCKETS, toUSDOn, fmt, logAgain, onEdit, softDeleteTransaction }: {
  financials: LocalFinancials;
  cards: StoredCard[];
  /** The live entries outside the current cycle. */
  pastTx: StoredTransaction[];
  startDay: ReturnType<typeof cycleStartDayOf>;
  TX_BUCKETS: { value: string; label: string; icon: string; color: string }[];
  toUSDOn: ReturnType<typeof makeToUSDOn>;
  fmt: (n: number) => string;
  logAgain: (t: StoredTransaction) => void;
  onEdit: (kind: "transaction", id: string) => void;
  softDeleteTransaction: (txId: string) => void;
}) {
  const T = useTheme();
  const byMonth: Record<CycleKey, StoredTransaction[]> = {} as Record<CycleKey, StoredTransaction[]>;
  pastTx.forEach((t) => {
    const ym = cycleKeyForISO(t.date, startDay);
    if (!byMonth[ym]) byMonth[ym] = [];
    byMonth[ym].push(t);
  });
  // Keys here are built by cycleKeyForISO above, so they are cycle
  // keys and get the range form (2.4.120).
  const label = (ym: CycleKey) => cycleLabel(ym, startDay);
  return (
      <div className="space-y-4">
        {/* Object.keys erases the brand -- it returns string[] whatever
            the Record says, deliberately, because an object may carry keys
            beyond its declared type. Re-asserted here, the same way
            TransactionsScreen:556 does (2.4.96, fourth row). */}
        {(Object.keys(byMonth) as CycleKey[]).sort().reverse().map((ym) => {
          const txs = byMonth[ym];
          // Excludes INCOME, matching the current month's total just
          // above (totalOut) and every other "spend" figure in the
          // app -- this used to include it, inflating past months'
          // totals for anyone who ever logged a gift/reimbursement.
          // TRANSFER (2.4.55) excluded too -- not spend, and its
          // amount can be negative (an incoming leg).
          // Session 19: the shared spending rule (lib/spending.ts): a change-back nets against Wants; income, transfers and other reimbursements stay out.
          const total = totalSpent(txs, (t) => toUSDOn(t.amount, t.currency, t.date));
          return (
            <div key={ym}>
              <div className="flex justify-between items-center mb-2">
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.mute }}>{label(ym)}</p>
                <p className="text-[10px] tabular-nums font-semibold" style={{ color: T.text }}>{fmt(total)}</p>
              </div>
              <div className="space-y-1.5">
                {txs.sort((a, b) => b.date.localeCompare(a.date)).map((tx) => {
                  const b = TX_BUCKETS.find((b) => b.value === tx.bucket)!;
                  const divergence = cycleMonthDivergence(tx, financials.recurring ?? [], startDay);
                  return (
                    <div key={tx.id} data-entry-row>
                        <EntryRow variant="history" tx={tx} b={b} divergence={divergence} financials={financials} cards={cards} logAgain={logAgain} onEdit={onEdit} softDeleteTransaction={softDeleteTransaction} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
  );
}
