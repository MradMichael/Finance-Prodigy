"use client";

import { useState } from "react";
import type { LocalFinancials, StoredRecurring, RecurringFrequency, Currency } from "../lib/localData";
import { FREQ_LABELS, allCategories, fmtDate, pendingBackfillCycles } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, DateFieldDMY, CurrencyToggle } from "./form/Primitives";

type Bucket = "NEEDS" | "WANTS" | "SAVINGS";

/**
 * Shared edit surface for a recurring item -- opened from InputPanel's
 * Manage tab and from RecurringScreen alike (usability backlog, 2026-08-29;
 * see EditDebtSheet's own comment for why this isn't four independent
 * implementations). Ported verbatim from InputPanel's former inline
 * edit-recurring form, including the pre-migration backfill sub-panel
 * (2.4.31) that already lived inside it.
 */
export default function EditRecurringSheet({
  recurring, financials, onChange, onClose, onBackfillRecurring, backfillingIds,
}: {
  recurring: StoredRecurring;
  financials: LocalFinancials;
  onChange: (updated: LocalFinancials) => void;
  onClose: () => void;
  onBackfillRecurring?: (recurringId: string, dueDate: Date) => void;
  backfillingIds?: Set<string>;
}) {
  const T = useTheme();
  const update = (patch: Partial<LocalFinancials>) => onChange({ ...financials, ...patch });
  const BUCKETS: { value: Bucket; label: string; icon: string; color: string }[] = [
    { value: "NEEDS",   label: "Needs",   icon: "🏠", color: T.sky   },
    { value: "WANTS",   label: "Wants",   icon: "✨", color: T.brass },
    { value: "SAVINGS", label: "Savings", icon: "💰", color: T.jade  },
  ];

  const [name,     setName]     = useState(recurring.name);
  const [emoji,    setEmoji]    = useState(recurring.emoji);
  const [amount,   setAmount]   = useState(String(recurring.amount));
  const [currency, setCurrency] = useState<Currency>(recurring.currency);
  const [freq,     setFreq]     = useState<RecurringFrequency>(recurring.frequency);
  const [bucket,   setBucket]   = useState<Bucket>(recurring.bucket);
  const [category, setCategory] = useState<string>(recurring.category ?? "");
  const [start,    setStart]    = useState(recurring.startDate);
  const [endType,  setEndType]  = useState<"infinite" | "date" | "amount">(
    recurring.endDate ? "date" : recurring.totalAmount ? "amount" : "infinite"
  );
  const [end,         setEnd]         = useState(recurring.endDate ?? "");
  const [totalAmount, setTotalAmount] = useState(recurring.totalAmount ? String(recurring.totalAmount) : "");

  const pendingBackfill = pendingBackfillCycles(recurring, financials.transactions);

  function save() {
    const amt = parseFloat(amount.replace(/,/g, ""));
    if (!name.trim() || isNaN(amt) || !start) return;
    update({
      recurring: (financials.recurring ?? []).map((r) => r.id !== recurring.id ? r : {
        ...r, name: name.trim(), emoji: emoji || "🔁",
        amount: amt, currency, frequency: freq,
        bucket, category: category || undefined, startDate: start,
        endDate:     endType === "date"   ? (end.trim() || null) : null,
        totalAmount: endType === "amount" ? (parseFloat(totalAmount.replace(/,/g, "")) || null) : null,
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
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Edit recurring</p>
          <button onClick={onClose} aria-label="Close" className="text-lg leading-none" style={{ color: T.mute }}>✕</button>
        </div>

        <div className="space-y-2.5">
          <div className="flex gap-2">
            <div style={{ width: 68 }}>
              <Label htmlFor="edit-rec-emoji">Icon</Label>
              <FocusInput id="edit-rec-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
            </div>
            <div className="flex-1">
              <Label htmlFor="edit-rec-name">Name</Label>
              <FocusInput id="edit-rec-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="edit-rec-amount">Amount</Label>
              <MoneyInput id="edit-rec-amount" value={amount} onChange={setAmount} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="edit-rec-freq">Frequency</Label>
              <select id="edit-rec-freq" value={freq} onChange={(e) => setFreq(e.target.value as RecurringFrequency)}
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}>
                {(Object.keys(FREQ_LABELS) as RecurringFrequency[]).map((f) => (
                  <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label>Currency</Label>
            <CurrencyToggle value={currency} onChange={setCurrency} />
          </div>
          <div>
            <Label>Type</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {BUCKETS.map((bkt) => (
                <button key={bkt.value} onClick={() => setBucket(bkt.value)}
                  aria-label={bkt.label}
                  aria-pressed={bucket === bkt.value}
                  className="py-1.5 rounded-xl text-[10px] font-medium transition-all"
                  style={{ background: bucket === bkt.value ? bkt.color + "22" : T.ink, border: `1px solid ${bucket === bkt.value ? bkt.color : T.line}`, color: bucket === bkt.value ? bkt.color : T.mute }}>
                  {bkt.icon} {bkt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="edit-rec-category">Category</Label>
            <select
              id="edit-rec-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-xs"
              style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
            >
              <option value="">No category</option>
              {allCategories(financials.customCategories).map((c) => (
                <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="edit-rec-start">Start date</Label>
            <DateFieldDMY id="edit-rec-start" value={start} onChange={setStart} />
          </div>
          <div>
            <Label>Ends</Label>
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              {(["infinite", "date", "amount"] as const).map((t) => (
                <button key={t} onClick={() => setEndType(t)}
                  className="py-1.5 rounded-xl text-[10px] font-medium transition-all"
                  style={{ background: endType === t ? T.jade + "22" : T.ink, border: `1px solid ${endType === t ? T.jade : T.line}`, color: endType === t ? T.jade : T.mute }}>
                  {t === "infinite" ? "∞ Never" : t === "date" ? "📅 Date" : "💰 Amount"}
                </button>
              ))}
            </div>
            {endType === "date" && <DateFieldDMY value={end} onChange={setEnd} />}
            {endType === "amount" && <MoneyInput value={totalAmount} onChange={setTotalAmount} placeholder="Total amount" />}
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={save} className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>Save</button>
          <button onClick={onClose} className="px-3 py-2 rounded-xl text-sm hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
        </div>

        {pendingBackfill.length > 0 && onBackfillRecurring && (
          <div className="mt-4 pt-4 space-y-1.5" style={{ borderTop: `1px solid ${T.line}` }}>
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.brass }}>
              Pre-migration cycles
            </p>
            <p className="text-[10px]" style={{ color: T.mute }}>
              From before this item started requiring confirmation. Not assumed paid -- mark any you actually paid.
            </p>
            {pendingBackfill.map((cycleDate) => {
              const cycleISO = cycleDate.toISOString().slice(0, 10);
              const key = `${recurring.id}:${cycleISO}`;
              const inFlight = backfillingIds?.has(key);
              return (
                <div key={cycleISO} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5" style={{ background: T.ink }}>
                  <span className="text-[11px]" style={{ color: T.text }}>{fmtDate(cycleISO)}</span>
                  <button
                    onClick={() => onBackfillRecurring(recurring.id, cycleDate)}
                    disabled={inFlight}
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all hover:opacity-80 disabled:opacity-40 disabled:hover:opacity-40"
                    style={{ background: T.jade + "22", color: T.jade }}
                  >
                    {inFlight ? "Confirming…" : "Confirm"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
