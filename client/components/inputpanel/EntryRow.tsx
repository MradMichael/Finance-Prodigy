"use client";

// InputPanel split, S5 (session 55): one row for a logged entry, in My Finances' This month and History. The
// two lists drew their rows separately and have always differed by design: This month shows the method and
// the category, History the date and the category; the boxes differ a little too (review 51, Part 4, item 5).
// Both are kept exactly, through `variant`: this is a move, not a merge of the two looks.
import type { LocalFinancials, StoredCard, StoredTransaction } from "../../lib/localData";
import { fmtDate, categoryIcon, categoryLabel } from "../../lib/localData";
import { logAgainEntry } from "../../lib/logAgain";
import { useTheme } from "../../contexts/ThemeContext";
import { fmtCur } from "../screens/shared";

export default function EntryRow({ variant, tx, b, divergence, financials, cards, logAgain, onEdit, softDeleteTransaction }: {
  variant: "month" | "history";
  tx: StoredTransaction;
  /** The entry's bucket, as the panel's bucket list describes it (icon and colour). */
  b: { icon: string; color: string };
  /** The note shown when a confirmed recurring bill's date and cycle month differ; null when they agree. */
  divergence: string | null;
  financials: LocalFinancials;
  cards: StoredCard[];
  logAgain: (t: StoredTransaction) => void;
  onEdit: (kind: "transaction", id: string) => void;
  softDeleteTransaction: (txId: string) => void;
}) {
  const T = useTheme();
  if (variant === "month") {
    return (
      <div
        className="flex items-center justify-between rounded-xl px-3 py-2.5 group"
        style={{ background: T.panelSoft, borderLeft: `3px solid ${b.color}` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">{b.icon}</span>
          <div className="min-w-0">
            <span className="text-xs truncate block" style={{ color: T.text }}>
              {tx.description}
              {divergence && <span title={divergence} style={{ color: T.brass }}> ⚠</span>}
            </span>
            {/* Was hover-only (title= alone) -- unreachable on touch. Same message, always visible when present, matching 2.4.36's own confirm-form warning below. */}
            {divergence && (
              <span className="text-[9px] block" style={{ color: T.brass }}>{divergence}</span>
            )}
            {(tx.paymentMethod || tx.category) && (
              <span className="text-[9px]" style={{ color: T.mute }}>
                {tx.paymentMethod && (
                  tx.paymentMethod === "card" && tx.cardLabel
                    ? <span className="whitespace-nowrap">{tx.cardLabel}</span>
                    : tx.paymentMethod === "cash"
                    ? "💵 Cash"
                    : tx.paymentMethod === "card"
                    ? "💳 Card"
                    : tx.paymentNote
                    ? `🤝 ${tx.paymentNote}`
                    : "🤝 Other"
                )}
                {tx.paymentMethod && tx.category && " · "}
                {tx.category && `${categoryIcon(tx.category, financials.customCategories)} ${categoryLabel(tx.category, financials.customCategories)}`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Session 54 (owner): below md, "Log again" sits under the amount as a 20 px pill, so the
              row keeps its height (beside it, a 44 px box on a touch screen squeezed the method and
              category line). Its button keeps the tap size (globals.css, .log-again-tap). From md
              up, beside the amount as before. */}
          <div className="flex flex-col items-end gap-0.5 md:flex-row md:items-center md:gap-1.5">
            <span className="text-xs font-semibold tabular-nums" style={{ color: b.color }}>
              {fmtCur(tx.amount, tx.currency ?? "USD")}
            </span>
            {logAgainEntry(tx, cards) && (
              <button
                onClick={() => logAgain(tx)}
                aria-label={`Log again: ${tx.description}`}
                className="log-again-tap md:flex md:items-stretch opacity-70 hover:!opacity-100 transition-opacity text-[10px] whitespace-nowrap"
              ><span className="inline-flex items-center h-5 md:h-auto px-1.5 rounded" style={{ color: T.jade, border: `1px solid ${T.jade}40` }}>Log again</span></button>
            )}
          </div>
          <button
            onClick={() => onEdit("transaction", tx.id)}
            aria-label="Edit transaction"
            className="opacity-70 hover:!opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
          >✎</button>
          <button
            onClick={() => { if (confirm("Delete this transaction?")) softDeleteTransaction(tx.id); }}
            aria-label="Delete transaction"
            className="opacity-70 hover:!opacity-100 transition-opacity text-xs px-1"
            style={{ color: T.coral }}
          >✕</button>
        </div>
      </div>
    );
  }
  return (
      <div
        className="flex items-center justify-between rounded-lg px-2.5 py-2 group"
        style={{ background: T.panelSoft, borderLeft: `2px solid ${b.color}` }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs truncate" style={{ color: T.text }}>
            {tx.description}
            {divergence && <span title={divergence} style={{ color: T.brass }}> ⚠</span>}
          </p>
          <p className="text-[9px]" style={{ color: T.mute }}>
            {fmtDate(tx.date)}{tx.category && ` · ${categoryIcon(tx.category, financials.customCategories)} ${categoryLabel(tx.category, financials.customCategories)}`}
          </p>
          {/* Was hover-only (title= alone) -- unreachable on touch. */}
          {divergence && (
            <p className="text-[9px]" style={{ color: T.brass }}>{divergence}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Session 54 (owner): as in This month, under the amount below md. */}
          <div className="flex flex-col items-end gap-0.5 md:flex-row md:items-center md:gap-1.5">
            <span className="text-xs tabular-nums font-medium" style={{ color: b.color }}>{fmtCur(tx.amount, tx.currency ?? "USD")}</span>
            {logAgainEntry(tx, cards) && (
              <button
                onClick={() => logAgain(tx)}
                aria-label={`Log again: ${tx.description}`}
                className="log-again-tap md:flex md:items-stretch opacity-70 hover:!opacity-100 transition-opacity text-[10px] whitespace-nowrap"
              ><span className="inline-flex items-center h-5 md:h-auto px-1.5 rounded" style={{ color: T.jade, border: `1px solid ${T.jade}40` }}>Log again</span></button>
            )}
          </div>
          <button
            onClick={() => onEdit("transaction", tx.id)}
            aria-label="Edit transaction"
            className="opacity-70 hover:!opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
          >✎</button>
          <button
            onClick={() => { if (confirm("Delete this transaction?")) softDeleteTransaction(tx.id); }}
            aria-label="Delete transaction"
            className="opacity-70 hover:!opacity-100 transition-opacity text-[10px] px-1"
            style={{ color: T.coral }}
          >✕</button>
        </div>
      </div>
  );
}
