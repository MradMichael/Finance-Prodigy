"use client";

import { useState } from "react";
import type { LocalFinancials, StoredDebt, PaymentMethod, StoredCard } from "../lib/localData";
import { buildDebtPaymentTx, derivedDebtBalance, derivedEfBalance, moneyEquals, roundMoney, allCategories, todayISO, uid, DEFAULT_LBP_RATE } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Label, MoneyInput, DateFieldDMY, PaymentMethodPicker } from "./form/Primitives";
import { fmtCur } from "./screens/shared";

type Bucket = "NEEDS" | "WANTS" | "SAVINGS";
const BUCKET_META: { value: Bucket; label: string; icon: string }[] = [
  { value: "NEEDS",   label: "Needs",   icon: "🏠" },
  { value: "WANTS",   label: "Wants",   icon: "✨" },
  { value: "SAVINGS", label: "Savings", icon: "💰" },
];

/**
 * Shared "record a payment" surface for a debt -- previously only reachable
 * from InputPanel's Manage tab; DebtsScreen (where a user is actually
 * looking at what they owe) had no way to pay from it at all (usability
 * backlog, 2026-08-29). Ported from InputPanel's former inline payment form
 * and recordDebtPayment, verbatim -- same builder, same paidOffAt logic.
 */
export default function PayDebtSheet({
  debt, financials, onChange, onClose,
}: {
  debt: StoredDebt;
  financials: LocalFinancials;
  onChange: (updated: LocalFinancials) => void;
  onClose: () => void;
}) {
  const T = useTheme();
  const update = (patch: Partial<LocalFinancials>) => onChange({ ...financials, ...patch });
  const cards = financials.cards ?? [];
  function saveCard(type: StoredCard["type"], last4: string): StoredCard | null {
    if (last4.length !== 4 || !/^\d{4}$/.test(last4)) return null;
    const card: StoredCard = { id: uid(), type, last4, label: `${type} •••• ${last4}` };
    update({ cards: [...cards, card] });
    return card;
  }

  const [amt,        setAmt]        = useState("");
  const [bucket,     setBucket]     = useState<Bucket>("NEEDS");
  const [category,   setCategory]   = useState("");
  const [fromEF,     setFromEF]     = useState(false);
  const [efAmt,      setEfAmt]      = useState("");
  const [method,     setMethod]     = useState<PaymentMethod>("cash");
  const [cardId,     setCardId]     = useState<string | null>(null);
  const [otherNote,  setOtherNote]  = useState("");
  const [date,       setDate]       = useState(todayISO());

  const balance = derivedDebtBalance(debt, financials.transactions);
  const efBalance = derivedEfBalance(financials);

  function save() {
    const amount = parseFloat(amt.replace(/,/g, ""));
    if (!amount || amount <= 0) return;
    const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
    let resolvedCardId: string | undefined;
    let resolvedCardLabel: string | undefined;
    if (method === "card" && cardId) {
      const card = cards.find((c) => c.id === cardId);
      if (card) { resolvedCardId = card.id; resolvedCardLabel = card.label; }
    }
    // Blank efAmt means "the full payment amount," same partial-amount
    // convention the main transaction form's own EF field uses. A debt
    // payment only ever DRAWS from EF, never contributes to it.
    const efAmtRaw = fromEF ? (efAmt.trim() ? parseFloat(efAmt.replace(/,/g, "")) : amount) : null;
    const efAmountUSD = efAmtRaw != null ? roundMoney(-(debt.currency === "LBP" ? efAmtRaw / lbpRate : efAmtRaw)) : undefined;
    const tx = buildDebtPaymentTx(debt, amount, bucket, lbpRate, {
      category: category || undefined,
      efAmount: efAmountUSD,
      paymentMethod: method,
      cardId: resolvedCardId, cardLabel: resolvedCardLabel,
      paymentNote: method === "other" && otherNote.trim() ? otherNote.trim() : undefined,
      date: date || todayISO(),
    });
    const newTransactions = [tx, ...financials.transactions];
    const newBal = derivedDebtBalance(debt, newTransactions);
    const updatedDebts = financials.debts.map((d) => d.id !== debt.id ? d : {
      ...d, paidOffAt: moneyEquals(newBal, 0) ? (d.paidOffAt ?? new Date().toISOString()) : d.paidOffAt,
    });
    update({ transactions: newTransactions, debts: updatedDebts });
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
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Record a payment</p>
          <button onClick={onClose} aria-label="Close" className="text-lg leading-none" style={{ color: T.mute }}>✕</button>
        </div>
        <p className="text-sm mb-4" style={{ color: T.text }}>{debt.name} · {fmtCur(balance, debt.currency)} owed</p>

        <div className="space-y-2.5">
          <div className="flex gap-2">
            <div className="flex-1">
              <MoneyInput value={amt} onChange={setAmt} placeholder="Payment amount" />
            </div>
          </div>
          <div>
            <Label htmlFor="pay-debt-date">Date paid</Label>
            <DateFieldDMY id="pay-debt-date" value={date} onChange={setDate} />
          </div>
          <div>
            <Label>Type</Label>
            {/* Owner's explicit instruction: never default this -- a minimum
                payment is a Need, a voluntary overpayment is closer to
                Savings, and guessing wrong silently skews budget pace. */}
            <div className="grid grid-cols-3 gap-1.5">
              {BUCKET_META.map((b) => (
                <button key={b.value} onClick={() => setBucket(b.value)}
                  aria-pressed={bucket === b.value}
                  className="py-1.5 rounded-lg text-[10px] font-medium transition-all"
                  style={{ background: bucket === b.value ? T.jade + "22" : T.panelSoft, border: `1px solid ${bucket === b.value ? T.jade : T.line}`, color: bucket === b.value ? T.jade : T.mute }}>
                  {b.icon} {b.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] mt-1" style={{ color: T.mute }}>
              Affects your budget pace, not this debt&apos;s balance — a minimum payment is usually a Need, extra above that is closer to Savings.
            </p>
          </div>
          <div>
            <Label htmlFor="pay-debt-category">Category</Label>
            <select
              id="pay-debt-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg px-2 py-1.5 text-[10px]"
              style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
            >
              <option value="">No category</option>
              {allCategories(financials.customCategories).map((c) => (
                <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>
          {/* Pay-from-EF only -- a debt payment only ever draws from the
              safety net, never contributes to it. */}
          {efBalance > 0 && (
            <>
              <button
                onClick={() => setFromEF((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all"
                style={{ background: fromEF ? T.coral + "18" : T.panelSoft, border: `1px solid ${fromEF ? T.coral : T.line}` }}
              >
                <p className="text-[10px] font-medium" style={{ color: fromEF ? T.coral : T.text }}>Pay this from Safety net</p>
                <span className="text-sm">{fromEF ? "✓" : "○"}</span>
              </button>
              {fromEF && (
                <MoneyInput value={efAmt} onChange={setEfAmt} placeholder={`Full amount (${amt || "0"})`} />
              )}
            </>
          )}
          <PaymentMethodPicker
            value={method}
            onChange={setMethod}
            cardId={cardId}
            onCardIdChange={setCardId}
            otherNote={otherNote}
            onOtherNoteChange={setOtherNote}
            cards={cards}
            onSaveCard={saveCard}
          />
          <p className="text-[10px]" style={{ color: T.mute }}>
            Balance after: {fmtCur(Math.max(0, balance - (parseFloat(amt.replace(/,/g, "")) || 0)), debt.currency)}
            {parseFloat(amt.replace(/,/g, "")) >= balance && balance > 0 && (
              <span style={{ color: T.jade }}>, fully paid off 🏁</span>
            )}
          </p>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={save} className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>Save</button>
          <button onClick={onClose} className="px-3 py-2 rounded-xl text-sm hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
