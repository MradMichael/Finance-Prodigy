"use client";

import { useState, useRef, useEffect } from "react";
import type { LocalFinancials, StoredCard, StoredTransaction, TrackedBalance } from "../lib/localData";
import { uid, todayISO, allCategories, matchCategoryRule, activeTransactions } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, PrimaryBtn, DateFieldDMY } from "./form/Primitives";
import { extractPositionedText, TooManyPagesError, CancelledError, LoadTimeoutError } from "../lib/statementImport/pdfText";
import {
  parseNeoStatement, normalizeDescription, guessAccountLast4,
  type ParsedTransaction, type Bucket,
} from "../lib/statementImport/neoBankAudiParser";
import { guessBucket } from "../lib/statementImport/categorize";

type Step = "pick" | "parsing" | "error" | "card" | "review";

interface ReviewRow {
  key: string;
  include: boolean;
  date: string;
  description: string;
  amount: string;
  bucket: Bucket;
  category: string;
  isDuplicate: boolean;
}

const BUCKET_OPTIONS: { value: Bucket; label: string }[] = [
  { value: "NEEDS", label: "Needs" },
  { value: "WANTS", label: "Wants" },
  { value: "SAVINGS", label: "Savings" },
];

export default function ImportStatement({
  financials, onImport, onClose,
}: {
  financials: LocalFinancials;
  onImport: (patch: Partial<LocalFinancials>) => void;
  onClose: () => void;
}) {
  const T = useTheme();
  const [step, setStep] = useState<Step>("pick");
  const [error, setError] = useState<string | null>(null);
  const [closingBalance, setClosingBalance] = useState<number | null>(null);
  const [closingBalanceDate, setClosingBalanceDate] = useState<string | null>(null);
  const [unmatchedRefundCount, setUnmatchedRefundCount] = useState(0);
  const [skippedTransferCount, setSkippedTransferCount] = useState(0);
  const [unparsedAmountCount, setUnparsedAmountCount] = useState(0);
  const cancelledRef = useRef(false);

  // Card step
  const [cardChoice, setCardChoice] = useState<string>(financials.cards[0]?.id ?? "new");
  const [newCardLabel, setNewCardLabel] = useState("NEO USD");
  const [newCardLast4, setNewCardLast4] = useState("");

  // Review step
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [addBalanceCheck, setAddBalanceCheck] = useState(true);

  // Stops an in-flight parse from doing (or reporting) further work once the
  // modal's gone — otherwise closing mid-parse either wastes CPU on a result
  // nobody will see, or worse, calls setState on an unmounted component.
  // Resetting to false on the setup side (not just true on cleanup) matters:
  // React 18 StrictMode (on by default in Next dev) mounts, runs this
  // effect's cleanup, then re-runs setup once as a one-time dev-only check —
  // a cleanup-only effect would leave cancelledRef permanently true after
  // that simulated cycle, marking every real parse "cancelled" before it
  // even starts. Re-arming on setup undoes that.
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  async function handleFile(file: File) {
    setStep("parsing");
    setError(null);
    try {
      const items = await extractPositionedText(file, () => cancelledRef.current);
      if (cancelledRef.current) return;
      const result = parseNeoStatement(items);

      if (result.noRowsFound) {
        setError("Couldn't find any purchases in this file. Is it a Neo by Bank Audi statement?");
        setStep("error");
        return;
      }
      if (result.transactions.length === 0) {
        setError("This statement parsed fine, but it has no purchases to import for this period. Nothing to do here.");
        setStep("error");
        return;
      }

      const guessedLast4 = guessAccountLast4(items);
      if (guessedLast4) setNewCardLast4(guessedLast4);

      setClosingBalance(result.closingBalance);
      setClosingBalanceDate(result.closingBalanceDate);
      setUnmatchedRefundCount(result.unmatchedRefunds.length);
      setSkippedTransferCount(result.skippedTransferCount);
      setUnparsedAmountCount(result.unparsedAmountCount);
      // Phase 2.6.3b: dedup against active transactions only -- a
      // deliberately-deleted entry shouldn't silently suppress a legitimate
      // re-import of the same real bank line.
      setRows(buildReviewRows(result.transactions, activeTransactions(financials.transactions)));
      setStep("card");
    } catch (e) {
      if (cancelledRef.current || e instanceof CancelledError) return;
      if (e instanceof TooManyPagesError) {
        setError("This PDF is too long to be a bank statement. Double-check it's the right file.");
      } else if (e instanceof LoadTimeoutError) {
        setError("This file took too long to open. It may be corrupted. Try re-exporting the statement PDF and uploading it again.");
      } else {
        setError("Couldn't read this PDF. Make sure it's a real statement file, not a scanned image.");
      }
      setStep("error");
    }
  }

  function buildReviewRows(parsed: ParsedTransaction[], existing: StoredTransaction[]): ReviewRow[] {
    return parsed.map((t) => {
      const isDuplicate = existing.some(
        (e) => e.date === t.date && e.amount === t.amount && normalizeDescription(e.description) === normalizeDescription(t.description),
      );
      return {
        key: uid(),
        include: !isDuplicate,
        date: t.date,
        description: t.description,
        amount: String(t.amount),
        bucket: guessBucket(t.description),
        // "If null only" doesn't really apply here -- an imported row has no
        // prior category to protect, so a rule match always fills it in as
        // the starting point (still editable per row before committing).
        category: matchCategoryRule(t.description, financials.categoryRules) ?? "",
        isDuplicate,
      };
    });
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  // The single source of truth for "will this row actually be imported" —
  // used for both the displayed count and commit()'s own filter, so the
  // button's promised count and what actually gets saved can never diverge.
  function isRowValid(r: ReviewRow): boolean {
    const amt = parseFloat(r.amount);
    return !isNaN(amt) && amt > 0;
  }

  function commit() {
    let card: StoredCard;
    if (cardChoice === "new") {
      if (newCardLast4.length !== 4 || !/^\d{4}$/.test(newCardLast4)) return;
      card = { id: uid(), type: "Other", last4: newCardLast4, label: newCardLabel.trim() || `Other •••• ${newCardLast4}` };
    } else {
      const existing = financials.cards.find((c) => c.id === cardChoice);
      if (!existing) return;
      card = existing;
    }

    // Hardcoded USD, no rate needed -- statement import doesn't support an
    // LBP source today, so there's no currency to capture a rate against.
    const importedAt = new Date().toISOString();
    const newTransactions: StoredTransaction[] = rows
      .filter((r) => r.include && isRowValid(r))
      .map((r) => ({
        id: uid(),
        amount: parseFloat(r.amount),
        currency: "USD" as const,
        bucket: r.bucket,
        description: r.description,
        date: r.date,
        paymentMethod: "card" as const,
        cardId: card.id,
        cardLabel: card.label,
        createdAt: importedAt, updatedAt: importedAt,
        ...(r.category ? { category: r.category } : {}),
      }));

    if (newTransactions.length === 0) return;

    const patch: Partial<LocalFinancials> = {
      transactions: [...newTransactions, ...financials.transactions],
      cards: cardChoice === "new" ? [...financials.cards, card] : financials.cards,
    };

    if (addBalanceCheck && closingBalance !== null) {
      // The statement's own closing-balance date -- that's when this figure
      // was actually true, not whenever the user happens to get around to
      // importing the file (which could be days or weeks later, and would
      // otherwise make computeDashboard.ts's balance check treat every
      // transaction logged in between as "already reflected," producing a
      // false mismatch or masking a real one).
      const balanceDate = closingBalanceDate ?? todayISO();
      // The closing balance IS the expected total as of that date, by
      // definition -- it's the bank's own tally after every transaction on
      // this same statement, so there's nothing to reconstruct here the
      // way a manual confirmation needs to (see updateActualBalance).
      const existingTB = financials.trackedBalances.find((tb) => tb.cardId === card.id);
      // Same as the transactions above -- hardcoded USD, no rate needed.
      const tbPatch: TrackedBalance = existingTB
        ? { ...existingTB, actualBalance: closingBalance, actualBalanceDate: balanceDate, expectedAtCheckUSD: closingBalance }
        : {
            id: uid(), name: card.label, paymentMethod: "card", cardId: card.id,
            startingBalance: closingBalance, startingDate: balanceDate, currency: "USD",
            actualBalance: closingBalance, actualBalanceDate: balanceDate, expectedAtCheckUSD: closingBalance,
          };
      patch.trackedBalances = existingTB
        ? financials.trackedBalances.map((tb) => (tb.id === existingTB.id ? tbPatch : tb))
        : [...financials.trackedBalances, tbPatch];
    }

    onImport(patch);
    onClose();
  }

  const includedCount = rows.filter((r) => r.include && isRowValid(r)).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import statement"
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 shadow-2xl"
        style={{ background: T.panel, border: `1px solid ${T.line}` }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.brass }}>Import statement</p>
            <h2 className="text-lg mt-1" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
              {step === "review" ? "Review before importing" : "Neo by Bank Audi"}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close import dialog" className="text-sm px-2" style={{ color: T.mute }}>✕</button>
        </div>

        {step === "pick" && (
          <div className="text-center py-10">
            <p className="text-xs mb-4" style={{ color: T.mute }}>
              Upload a PDF statement. Everything is parsed in your browser, the file never leaves your device.
            </p>
            <label
              className="inline-block px-5 py-3 rounded-xl text-sm font-semibold cursor-pointer transition-all hover:opacity-90"
              style={{ background: T.jade, color: T.ink }}
            >
              Choose PDF file
              <input
                type="file" accept="application/pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </label>
          </div>
        )}

        {step === "parsing" && (
          <div className="text-center py-10">
            <p className="text-sm" style={{ color: T.mute }}>Reading statement…</p>
          </div>
        )}

        {step === "error" && (
          <div className="text-center py-10">
            <p className="text-sm mb-4" style={{ color: T.coral }}>{error}</p>
            <button onClick={() => setStep("pick")} className="text-xs underline" style={{ color: T.mute }}>Try another file</button>
          </div>
        )}

        {step === "card" && (
          <div className="space-y-4">
            <p className="text-xs" style={{ color: T.mute }}>
              Which card/account should these {rows.length} purchases be logged against?
              {skippedTransferCount > 0 && ` (${skippedTransferCount} account top-up transfer${skippedTransferCount === 1 ? "" : "s"} skipped, not spending.)`}
            </p>
            {financials.cards.length > 0 && (
              <div>
                <Label>Existing card</Label>
                <select
                  value={cardChoice} onChange={(e) => setCardChoice(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text }}
                >
                  {financials.cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  <option value="new">+ New card</option>
                </select>
              </div>
            )}
            {cardChoice === "new" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Label</Label>
                  <FocusInput value={newCardLabel} onChange={(e) => setNewCardLabel(e.target.value)} placeholder="NEO USD" />
                </div>
                <div>
                  <Label>Last 4 digits</Label>
                  <FocusInput
                    value={newCardLast4} maxLength={4} inputMode="numeric"
                    onChange={(e) => setNewCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="0005"
                  />
                </div>
              </div>
            )}
            <PrimaryBtn
              onClick={() => setStep("review")}
              disabled={cardChoice === "new" && !/^\d{4}$/.test(newCardLast4)}
            >
              Continue
            </PrimaryBtn>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <p className="text-xs" style={{ color: T.mute }}>
              {includedCount} of {rows.length} selected.
              {unmatchedRefundCount > 0 && ` ${unmatchedRefundCount} refund${unmatchedRefundCount === 1 ? "" : "s"} in this statement had no matching purchase to net against, so ${unmatchedRefundCount === 1 ? "it wasn't" : "they weren't"} imported.`}
              {unparsedAmountCount > 0 && ` ${unparsedAmountCount} row${unparsedAmountCount === 1 ? "" : "s"} had an amount in an unexpected format and couldn't be read. Check the statement for anything missing.`}
            </p>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {rows.map((r) => (
                <div
                  key={r.key}
                  className="rounded-xl p-3"
                  style={{ background: T.panelSoft, border: `1px solid ${r.isDuplicate ? T.coral : T.line}`, opacity: r.include ? 1 : 0.5 }}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox" checked={r.include} className="mt-1"
                      onChange={(e) => updateRow(r.key, { include: e.target.checked })}
                    />
                    <div className="flex-1 space-y-2">
                      {r.isDuplicate && (
                        <p className="text-[10px] font-semibold" style={{ color: T.coral }}>
                          Possible duplicate: same date, amount, and description as a transaction you already have. Left unchecked; check the box above if it&apos;s actually a separate purchase.
                        </p>
                      )}
                      {r.include && !isRowValid(r) && (
                        <p className="text-[10px] font-semibold" style={{ color: T.coral }}>Enter a valid amount. This row won&apos;t be imported as-is.</p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
                        <FocusInput value={r.description} onChange={(e) => updateRow(r.key, { description: e.target.value })} />
                        <DateFieldDMY value={r.date} onChange={(iso) => updateRow(r.key, { date: iso })} />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <MoneyInput value={r.amount} onChange={(v) => updateRow(r.key, { amount: v })} placeholder="0.00" />
                        <select
                          value={r.bucket} onChange={(e) => updateRow(r.key, { bucket: e.target.value as Bucket })}
                          className="w-full rounded-xl px-3 py-2 text-sm"
                          style={{ background: T.panel, border: `1px solid ${T.line}`, color: T.text }}
                        >
                          {BUCKET_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                        </select>
                        <select
                          value={r.category} onChange={(e) => updateRow(r.key, { category: e.target.value })}
                          aria-label="Category"
                          className="w-full rounded-xl px-3 py-2 text-sm"
                          style={{ background: T.panel, border: `1px solid ${T.line}`, color: T.text }}
                        >
                          <option value="">No category</option>
                          {allCategories(financials.customCategories).map((c) => (
                            <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {closingBalance !== null && (
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={addBalanceCheck} onChange={(e) => setAddBalanceCheck(e.target.checked)} className="mt-0.5" />
                <span className="text-xs" style={{ color: T.mute }}>
                  Also update this card&apos;s Balance Check with the statement&apos;s closing balance (${closingBalance.toFixed(2)}).
                </span>
              </label>
            )}

            <PrimaryBtn onClick={commit} disabled={includedCount === 0}>Import {includedCount} transaction{includedCount === 1 ? "" : "s"}</PrimaryBtn>
          </div>
        )}
      </div>
    </div>
  );
}
