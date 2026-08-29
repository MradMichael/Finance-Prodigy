"use client";

import { useState } from "react";
import type { LocalFinancials, StoredTransaction, StoredCard, Currency, PaymentMethod } from "../lib/localData";
import {
  fmtDate, allCategories, looksRecurring, buildQuickRecurring, cycleMonthDivergence,
  roundMoney, uid, DEFAULT_LBP_RATE,
} from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, DateFieldDMY, CurrencyToggle, PM_OPTIONS, CardPicker } from "./form/Primitives";

type TxBucket = "NEEDS" | "WANTS" | "SAVINGS" | "INCOME";

/**
 * Shared edit surface for a transaction -- opened from InputPanel's Manage
 * tab (both "This month" and "History," previously two independently
 * rendered copies of this exact form) and from TransactionsScreen alike
 * (usability backlog, 2026-08-29; see EditDebtSheet's own comment for the
 * duplication history this pattern exists to stop repeating).
 *
 * The "looks recurring" convert nudge is shown based on the transaction's
 * OWN date being in the current month, not on which screen opened this --
 * reproduces exactly what the two original copies did (This month: shown;
 * History: never shown), now as one rule instead of one copy having it and
 * the other not.
 *
 * The LBP-low-amount confirm dialog is deliberately duplicated here rather
 * than shared with InputPanel's own add-transaction copy -- it's a simple,
 * fixed-text confirmation gate, not diverging calculation logic (the class
 * of duplication this codebase has actually been burned by).
 */
export default function EditTransactionSheet({
  transaction, financials, onChange, onClose,
}: {
  transaction: StoredTransaction;
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

  const TX_BUCKETS: { value: TxBucket; label: string; icon: string; color: string }[] = [
    { value: "NEEDS",   label: "Needs",   icon: "🏠", color: T.sky   },
    { value: "WANTS",   label: "Wants",   icon: "✨", color: T.brass },
    { value: "SAVINGS", label: "Savings", icon: "💰", color: T.jade  },
    { value: "INCOME",  label: "Income",  icon: "📥", color: T.jade  },
  ];

  const [amt,        setAmt]        = useState(String(transaction.amount));
  const [desc,       setDesc]       = useState(transaction.description);
  const [date,       setDate]       = useState(transaction.date);
  const [bucket,     setBucket]     = useState<TxBucket>(transaction.bucket);
  const [category,   setCategory]   = useState<string>(transaction.category ?? "");
  const [currency,   setCurrency]   = useState<Currency>(transaction.currency ?? "USD");
  const [payMethod,  setPayMethod]  = useState<PaymentMethod>(transaction.paymentMethod ?? "cash");
  const [payNote,    setPayNote]    = useState(transaction.paymentNote ?? "");
  const [cardId,     setCardId]     = useState<string | null>(transaction.cardId ?? null);
  // 2.4.32/2.6.3c: tri-state, undefined = never linked (nothing to show),
  // a real value = still linked (show it, offer Detach), null = deliberately
  // detached (this session's edit) -- see StoredTransaction's own comment.
  const [cycleDate,  setCycleDate]  = useState<string | null | undefined>(transaction.cycleDate);
  const [efAmount,   setEfAmount]   = useState<string | null | undefined>(
    transaction.efAmount == null ? transaction.efAmount : String(
      transaction.currency === "LBP" ? roundMoney(transaction.efAmount * (financials.lbpRate ?? DEFAULT_LBP_RATE)) : transaction.efAmount
    )
  );
  const [debtId,          setDebtId]          = useState<string | undefined>(transaction.debtId);
  const [debtAdjustment,  setDebtAdjustment]  = useState<string | null | undefined>(
    transaction.debtAdjustment == null ? transaction.debtAdjustment : String(transaction.debtAdjustment)
  );
  const [lbpConfirmAmount, setLbpConfirmAmount] = useState<number | null>(null);

  const divergence = cycleMonthDivergence(transaction, financials.recurring ?? []);
  const showRecurringNudge = bucket !== "INCOME"
    && date.slice(0, 7) === new Date().toISOString().slice(0, 7)
    && looksRecurring(desc, date, financials.transactions.filter((t) => t.id !== transaction.id), financials.recurring ?? []);

  function convertToRecurring() {
    const rec = buildQuickRecurring(desc, amt, currency, bucket === "INCOME" ? "NEEDS" : bucket, category);
    if (!rec) return;
    update({ recurring: [...(financials.recurring ?? []), rec] });
  }

  function save() {
    const amtNum = parseFloat(amt.replace(/,/g, ""));
    if (!desc.trim() || isNaN(amtNum) || !date) return;
    if (currency === "LBP" && amtNum < 500) { setLbpConfirmAmount(amtNum); return; }
    commit();
  }

  function commit() {
    const amtNum = parseFloat(amt.replace(/,/g, ""));
    if (!desc.trim() || isNaN(amtNum) || !date) return;
    let resolvedCardId: string | undefined;
    let resolvedCardLabel: string | undefined;
    if (payMethod === "card" && cardId) {
      const card = cards.find((c) => c.id === cardId);
      if (card) { resolvedCardId = card.id; resolvedCardLabel = card.label; }
    }
    const efAmountUSD = efAmount == null ? efAmount : roundMoney(
      currency === "LBP"
        ? (parseFloat(efAmount.replace(/,/g, "")) || 0) / (financials.lbpRate ?? DEFAULT_LBP_RATE)
        : (parseFloat(efAmount.replace(/,/g, "")) || 0)
    );
    const debtAdjustmentNum = debtAdjustment == null ? debtAdjustment
      : roundMoney(parseFloat(debtAdjustment.replace(/,/g, "")) || 0);
    update({
      transactions: financials.transactions.map((t) => t.id !== transaction.id ? t : {
        ...t, amount: amtNum, description: desc.trim(),
        date, bucket, category: category || undefined, currency,
        paymentMethod: payMethod,
        paymentNote: payMethod === "other" && payNote.trim() ? payNote.trim() : undefined,
        cardId: resolvedCardId, cardLabel: resolvedCardLabel,
        cycleDate,
        efAmount: efAmountUSD,
        debtId,
        debtAdjustment: debtAdjustmentNum,
        updatedAt: new Date().toISOString(),
      }),
    });
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
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Edit entry</p>
          <button onClick={onClose} aria-label="Close" className="text-lg leading-none" style={{ color: T.mute }}>✕</button>
        </div>

        <div className="space-y-2.5">
          {divergence && (
            <p className="text-[10px]" style={{ color: T.brass }}>⚠ {divergence}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="edit-tx-amount">Amount</Label>
              <MoneyInput id="edit-tx-amount" value={amt} onChange={setAmt} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="edit-tx-date">Date</Label>
              <DateFieldDMY id="edit-tx-date" value={date} onChange={setDate} />
            </div>
          </div>
          <div>
            <Label htmlFor="edit-tx-desc">Description</Label>
            <FocusInput id="edit-tx-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
            {showRecurringNudge && (
              <div className="mt-2 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2" style={{ background: T.brass + "14", border: `1px solid ${T.brass}30` }}>
                <p className="text-[11px]" style={{ color: T.brass }}>You&apos;ve logged this before in another month. Looks recurring.</p>
                <button
                  type="button"
                  onClick={convertToRecurring}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 hover:opacity-80 transition-opacity"
                  style={{ background: T.brass + "22", color: T.brass }}
                >
                  Add to Recurring
                </button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {TX_BUCKETS.map((bkt) => (
              <button key={bkt.value} onClick={() => setBucket(bkt.value)}
                className="py-1.5 rounded-lg text-[10px] font-medium transition-all"
                style={{ background: bucket === bkt.value ? bkt.color + "22" : T.ink, border: `1px solid ${bucket === bkt.value ? bkt.color : T.line}`, color: bucket === bkt.value ? bkt.color : T.mute }}>
                {bkt.icon} {bkt.label}
              </button>
            ))}
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Category"
            className="w-full rounded-lg px-2 py-1.5 text-[10px]"
            style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
          >
            <option value="">No category</option>
            {allCategories(financials.customCategories).map((c) => (
              <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
            ))}
          </select>
          <CurrencyToggle value={currency} onChange={setCurrency} />
          <div>
            <div className="grid grid-cols-3 gap-1.5 mb-1.5">
              {PM_OPTIONS.map((p) => (
                <button key={p.value} type="button"
                  onClick={() => { setPayMethod(p.value); setCardId(null); }}
                  className="py-1.5 rounded-lg text-[10px] font-medium transition-all"
                  style={{ background: payMethod === p.value ? T.jade + "22" : T.ink, border: `1px solid ${payMethod === p.value ? T.jade : T.line}`, color: payMethod === p.value ? T.jade : T.mute }}
                >{p.icon} {p.label}</button>
              ))}
            </div>
            {payMethod === "card" && (
              <CardPicker cardId={cardId} onCardIdChange={setCardId} cards={cards} onSaveCard={saveCard} />
            )}
            {payMethod === "other" && (
              <FocusInput value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Who paid or how?" />
            )}
          </div>
          {cycleDate && (
            <div className="rounded-lg px-2.5 py-2 flex items-center justify-between gap-2" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
              <p className="text-[10px]" style={{ color: T.mute }}>
                Settles: <span style={{ color: T.text }}>{financials.recurring?.find((r) => r.id === transaction.recurringId)?.name ?? "a deleted recurring item"}</span> · {fmtDate(cycleDate)}
              </p>
              <button
                type="button"
                onClick={() => setCycleDate(null)}
                aria-label="Detach this transaction from its recurring cycle"
                className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all hover:opacity-80 flex-shrink-0"
                style={{ color: T.coral, border: `1px solid ${T.coral}40` }}
              >
                Detach
              </button>
            </div>
          )}
          {efAmount != null ? (
            <div className="rounded-lg px-2.5 py-2 space-y-1.5" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px]" style={{ color: T.mute }}>Emergency fund</p>
                <button type="button" onClick={() => setEfAmount(null)} aria-label="Detach this transaction from the emergency fund" className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all hover:opacity-80 flex-shrink-0" style={{ color: T.coral, border: `1px solid ${T.coral}40` }}>Detach</button>
              </div>
              <MoneyInput value={efAmount} onChange={setEfAmount} placeholder="0" />
              <p className="text-[9px]" style={{ color: T.mute }}>Positive adds to it, negative draws from it.</p>
            </div>
          ) : (
            <button type="button" onClick={() => setEfAmount(amt)} className="text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all hover:opacity-80" style={{ color: T.jade, border: `1px solid ${T.jade}40` }}>+ Link to Emergency fund</button>
          )}
          <div>
            <Label htmlFor="edit-tx-debt">Linked debt</Label>
            <select
              id="edit-tx-debt"
              value={debtId ?? ""}
              onChange={(e) => {
                const id = e.target.value || undefined;
                setDebtId(id);
                if (!id) setDebtAdjustment(undefined);
              }}
              className="w-full rounded-lg px-2 py-1.5 text-[10px]"
              style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
            >
              <option value="">Not linked</option>
              {financials.debts.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          {debtId && (
            debtAdjustment != null ? (
              <div className="rounded-lg px-2.5 py-2 space-y-1.5" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px]" style={{ color: T.mute }}>Debt correction</p>
                  <button type="button" onClick={() => setDebtAdjustment(null)} aria-label="Detach this debt correction" className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all hover:opacity-80 flex-shrink-0" style={{ color: T.coral, border: `1px solid ${T.coral}40` }}>Detach</button>
                </div>
                <MoneyInput value={debtAdjustment} onChange={setDebtAdjustment} placeholder="0" />
                <p className="text-[9px]" style={{ color: T.mute }}>Positive increases the debt, negative reduces it further.</p>
              </div>
            ) : (
              <button type="button" onClick={() => setDebtAdjustment("0")} className="text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all hover:opacity-80" style={{ color: T.jade, border: `1px solid ${T.jade}40` }}>+ Add debt correction</button>
            )
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={save} className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>Save</button>
          <button onClick={onClose} className="px-3 py-2 rounded-xl text-sm hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
        </div>
      </div>

      {lbpConfirmAmount != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setLbpConfirmAmount(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm low LBP amount"
            className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
            style={{ background: T.panel, border: `1px solid ${T.line}` }}
          >
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: T.brass }}>Double-check this amount</p>
            <p className="text-sm mb-5" style={{ color: T.text }}>
              <strong>{lbpConfirmAmount.toLocaleString()} LBP</strong> is unusually low for a real purchase — most things this cheap are actually meant to be USD. Did you mean to log this in USD instead?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setLbpConfirmAmount(null)}
                className="w-full py-2.5 rounded-xl text-sm font-semibold hover:opacity-90"
                style={{ background: T.jade, color: T.ink }}
              >
                Let me fix the currency
              </button>
              <button
                onClick={() => { setLbpConfirmAmount(null); commit(); }}
                className="w-full py-2.5 rounded-xl text-sm hover:opacity-90"
                style={{ background: T.panelSoft, color: T.mute, border: `1px solid ${T.line}` }}
              >
                No, save it as {lbpConfirmAmount.toLocaleString()} LBP
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
