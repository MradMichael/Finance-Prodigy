"use client";

// InputPanel split, S10 (session 55): My Finances' Recurring Payments section, moved here line for line. The
// section's header (title and count) stays in InputPanel; a closed section doesn't build this at all.
import { useState } from "react";
import type { LocalFinancials, Currency, StoredRecurring, RecurringFrequency, cycleStartDayOf, makeToUSDLive } from "../../lib/localData";
import { uid, todayISO, fmtDate, lbpRateOf, edited, recordDeletion, moneyMaxFor, FREQ_LABELS, FREQ_MONTHLY, nominalMonthlyEquivalent, isRecurringActive, nextConfirmTarget, isCycleConfirmed, recurringPaidSoFar, remainingInstallments, buildExtraPaymentTx } from "../../lib/localData";
import { cycleKeyForISO, cycleLabel, type periodNoun } from "../../lib/period";
import type { calendarDayOf } from "../../lib/calendarDay";
import { useTheme } from "../../contexts/ThemeContext";
import CategoryOptions from "../form/CategoryOptions";
import { Label, FocusInput, MoneyInput, PrimaryBtn, CurrencyToggle, DateFieldDMY } from "../form/Primitives";

/** Recurring Payments: its form's state. InputPanel calls this, so the state lives there and what is typed survives closing the section, as before the move. */
export function useRecurringForm() {
  // Recurring form
  const [rName,        setRName]        = useState("");
  const [rEmoji,       setREmoji]       = useState("🔁");
  const [rAmount,      setRAmount]      = useState("");
  const [rCurrency,    setRCurrency]    = useState<Currency>("USD");
  const [rFreq,        setRFreq]        = useState<RecurringFrequency>("monthly");
  const [rBucket,      setRBucket]      = useState<"NEEDS" | "WANTS" | "SAVINGS">("NEEDS");
  const [rCategory,    setRCategory]    = useState<string>("");
  const [rStart,       setRStart]       = useState(todayISO());
  const [rEndType,     setREndType]     = useState<"infinite" | "date" | "amount">("infinite");
  const [rEnd,         setREnd]         = useState("");
  const [rTotalAmount, setRTotalAmount] = useState("");
  // Recurring extra payment state
  const [extraRecId,  setExtraRecId]  = useState<string | null>(null);
  const [extraRecAmt, setExtraRecAmt] = useState("");
  // Recurring confirm state (2.4.30, finding A) -- confirmDate defaults to
  // the target cycle's own due date when the form opens, editable to
  // record the date actually paid.
  const [confirmingRecId, setConfirmingRecId] = useState<string | null>(null);
  const [confirmDate,     setConfirmDate]     = useState("");
  return { rName, setRName, rEmoji, setREmoji, rAmount, setRAmount, rCurrency, setRCurrency, rFreq, setRFreq, rBucket, setRBucket, rCategory, setRCategory, rStart, setRStart, rEndType, setREndType, rEnd, setREnd, rTotalAmount, setRTotalAmount, extraRecId, setExtraRecId, extraRecAmt, setExtraRecAmt, confirmingRecId, setConfirmingRecId, confirmDate, setConfirmDate };
}

export default function RecurringSection({ financials, update, lbpRate, onEdit, BUCKETS, noun, startDay, today, toUSD, onConfirmRecurring, loggingRecurringIds, justConfirmedIds, form }: {
  financials: LocalFinancials;
  update: (patch: Partial<LocalFinancials>) => void;
  lbpRate: number;
  onEdit: (kind: "recurring", id: string) => void;
  BUCKETS: { value: "NEEDS" | "WANTS" | "SAVINGS"; label: string; icon: string; color: string }[];
  noun: ReturnType<typeof periodNoun>;
  startDay: ReturnType<typeof cycleStartDayOf>;
  today: ReturnType<typeof calendarDayOf>;
  toUSD: ReturnType<typeof makeToUSDLive>;
  onConfirmRecurring: ((recurringId: string, paidDate?: Date) => void) | undefined;
  loggingRecurringIds: Set<string> | undefined;
  justConfirmedIds: Set<string> | undefined;
  form: ReturnType<typeof useRecurringForm>;
}) {
  const T = useTheme();
  const { rName, setRName, rEmoji, setREmoji, rAmount, setRAmount, rCurrency, setRCurrency, rFreq, setRFreq, rBucket, setRBucket, rCategory, setRCategory, rStart, setRStart, rEndType, setREndType, rEnd, setREnd, rTotalAmount, setRTotalAmount, extraRecId, setExtraRecId, extraRecAmt, setExtraRecAmt, confirmingRecId, setConfirmingRecId, confirmDate, setConfirmDate } = form;

  function addRecurring() {
    if (!rName.trim() || !rAmount || !rStart) return;
    const rec: StoredRecurring = {
      id: uid(), name: rName.trim(), emoji: rEmoji || "🔁",
      amount: parseFloat(rAmount.replace(/,/g, "")), currency: rCurrency, frequency: rFreq,
      bucket: rBucket, ...(rCategory ? { category: rCategory } : {}), startDate: rStart,
      endDate:     rEndType === "date"   ? (rEnd.trim() || null) : null,
      totalAmount: rEndType === "amount" ? (parseFloat(rTotalAmount.replace(/,/g, "")) || null) : null,
      createdAt: new Date().toISOString(),
    };
    update({ recurring: [...(financials.recurring ?? []), edited(rec)] });
    setRName(""); setRAmount(""); setREmoji("🔁"); setRCategory(""); setRStart(todayISO()); setREnd(""); setRTotalAmount(""); setREndType("infinite");
  }

  function logExtraPayment(rec: StoredRecurring) {
    const amt = parseFloat(extraRecAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    const tx = buildExtraPaymentTx(rec, amt, lbpRateOf(financials));
    update({ transactions: [tx, ...financials.transactions] });
    setExtraRecId(null); setExtraRecAmt("");
  }

  return (
    <>
      {(() => {
        const recs = financials.recurring ?? [];
        const now  = new Date();
        // Nominal (payment-status-independent) figures -- this section is
        // "what am I committed to," which shouldn't dip to $0 for a bill
        // that's simply already been paid this cycle. Actual spend/budget
        // totals elsewhere keep using monthlyEquivalent, which correctly
        // suppresses a paid cycle to avoid double-counting real spend.
        // CUR-01: each item's figure is in its OWN currency, so convert
        // before adding -- the same toUSD RecurringScreen applies.
        const totalMonthly = recs.reduce((s, r) => s + toUSD(nominalMonthlyEquivalent(r, financials.transactions, financials, now), r.currency), 0);
        return (
          <>
            {recs.length > 0 && (
              <div className="space-y-2 mb-1">
                {recs.map((r) => {
                  const mo     = nominalMonthlyEquivalent(r, financials.transactions, financials, now);
                  const b      = BUCKETS.find((b) => b.value === r.bucket)!;
                  const cur    = r.currency ?? "USD";
                  const sym    = cur === "LBP" ? "L£" : "$";
                  const target = nextConfirmTarget(r, financials.transactions, financials, today);
                  // 2.4.112: "ended" is now asked of BOTH bounds, because
                  // isRecurringActive no longer guesses exhaustion from
                  // elapsed time. A capped item is over when the money is
                  // spent -- remainingInstallments returns null then --
                  // and otherwise only when its endDate passes.
                  //
                  // This also closes a bug the old form had in the other
                  // direction: an item paid off EARLY kept reading as live
                  // until the calendar caught up.
                  const ended  = !isRecurringActive(r, now)
                    || (r.totalAmount != null && remainingInstallments(r, financials.transactions, financials, today) === null);
                  const overdue = (target?.overdueCount ?? 0) > 0;
                  // Covers both "confirmed on time" and "confirmed early" (paid ahead of its due date) -- either way still shown as paid.
                  const paidThisCycle = target ? isCycleConfirmed(r, target.dueDate, financials.transactions) : false;
                  const paid   = r.totalAmount ? recurringPaidSoFar(r, financials.transactions, financials) : null;
                  const pct    = paid != null && r.totalAmount ? Math.min(100, (paid / r.totalAmount) * 100) : null;
                  const remaining = !ended ? remainingInstallments(r, financials.transactions, financials, today) : null;
                  const isAddingExtra = extraRecId === r.id;
                  const isConfirming  = confirmingRecId === r.id;
                  const justConfirmed = justConfirmedIds?.has(r.id);
                  return (
                    <div key={r.id}>
                      <div
                        className="rounded-xl px-3 py-2.5"
                        style={{
                          background: T.panelSoft,
                          borderLeft: `3px solid ${ended ? T.mute : b.color}`,
                          opacity: ended ? 0.5 : 1,
                        }}
                      >
                        <div className="flex items-start justify-between gap-2 group">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm" style={{ color: T.text }}>
                              {r.emoji} {r.name}
                              {ended && <span className="ml-1.5 text-[9px] uppercase tracking-wider" style={{ color: T.mute }}>ended</span>}
                              {!ended && overdue && <span className="ml-1.5 text-[9px] uppercase tracking-wider" style={{ color: T.coral }}>overdue{target!.overdueCount > 1 ? ` ×${target!.overdueCount}` : ""}</span>}
                              {!ended && !overdue && paidThisCycle && <span className="ml-1.5 text-[9px] uppercase tracking-wider" style={{ color: T.jade }}>✓ paid</span>}
                              <span className="ml-1.5 text-[9px] uppercase tracking-wider px-1 rounded" style={{ background: cur === "LBP" ? T.brass + "22" : T.jade + "15", color: cur === "LBP" ? T.brass : T.jade }}>{cur}</span>
                            </p>
                            <p className="text-[10px] mt-0.5 tabular-nums" style={{ color: T.mute }}>
                              {sym}{r.amount.toLocaleString("en-US")} · {FREQ_LABELS[r.frequency]}
                              <span style={{ color: b.color }}> · {b.label}</span>
                            </p>
                            {r.createdAt && (
                              <p className="text-[9px] mt-0.5" style={{ color: T.mute }}>Added {fmtDate(r.createdAt)}</p>
                            )}
                            {r.totalAmount ? (
                              <div className="mt-1.5">
                                <div className="flex justify-between text-[9px] mb-0.5" style={{ color: T.mute }}>
                                  <span>{sym}{(paid ?? 0).toLocaleString("en-US")} paid</span>
                                  <span>{sym}{r.totalAmount.toLocaleString("en-US")} total</span>
                                </div>
                                <div className="h-1 rounded-full overflow-hidden" style={{ background: T.line }}>
                                  <div className="h-full rounded-full transition-all" style={{ width: `${pct ?? 0}%`, background: ended ? T.mute : b.color }} />
                                </div>
                                {remaining && (
                                  <p className="text-[9px] mt-1" style={{ color: T.mute }}>
                                    {remaining.count} payment{remaining.count === 1 ? "" : "s"} left · ends {fmtDate(remaining.endsOn.toISOString().slice(0, 10))}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-[10px] mt-0.5" style={{ color: T.mute }}>
                                {fmtDate(r.startDate)} → {r.endDate ? fmtDate(r.endDate) : <span style={{ color: T.jade }}>∞ ongoing</span>}
                                {remaining && ` · ${remaining.count} left`}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span className="text-xs font-semibold tabular-nums" style={{ color: b.color }}>
                              {sym}{Math.round(mo).toLocaleString("en-US")}<span className="font-normal" style={{ color: T.mute }}>/mo</span>
                            </span>
                            <div className="flex gap-1.5 opacity-70 transition-opacity">
                              <button
                                onClick={() => onEdit("recurring", r.id)}
                                aria-label="Edit recurring payment"
                                className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                                style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                              >✎</button>
                              {!ended && target && onConfirmRecurring && (
                                <button
                                  onClick={() => { setConfirmingRecId(isConfirming ? null : r.id); setConfirmDate(target.dueDate.toISOString().slice(0, 10)); }}
                                  disabled={loggingRecurringIds?.has(r.id)}
                                  aria-label={`Confirm this ${r.name} payment`}
                                  className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80 disabled:opacity-40 disabled:hover:opacity-40"
                                  style={{ color: justConfirmed ? T.jade : overdue ? T.coral : T.jade, border: `1px solid ${(justConfirmed ? T.jade : overdue ? T.coral : T.jade)}40` }}
                                >
                                  {loggingRecurringIds?.has(r.id) ? "Confirming…" : justConfirmed ? "Confirmed ✓" : "Confirm"}
                                </button>
                              )}
                              {!ended && (
                                <button
                                  onClick={() => { setExtraRecId(isAddingExtra ? null : r.id); setExtraRecAmt(""); }}
                                  aria-label="Log an extra payment"
                                  className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                                  style={{ color: T.jade, border: `1px solid ${T.jade}40` }}
                                >
                                  +extra
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  if (!confirm("Delete this recurring payment?")) return;
                                  // 2.4.35: every transaction confirmed against this item would
                                  // otherwise keep a permanently dangling recurringId/cycleDate --
                                  // detach both, same as the edit-transaction form's own Detach
                                  // button does deliberately (cycleDate: null, recurringId has no
                                  // sentinel need per its own comment, so undefined). The
                                  // transaction itself is real spend/income and stays.
                                  update({
                                    recurring: recs.filter((x) => x.id !== r.id),
                                    deletedKeys: recordDeletion(financials, "recurring", r.id),
                                    // 2.4.126: extraForRecurringId is cleared here too. It is a
                                    // link to this same item and would dangle exactly the way
                                    // 2.4.35 describes -- but it gets no cycleDate sentinel,
                                    // because an extra payment never settled a cycle to detach
                                    // from. Undefined is the whole of its cleared state.
                                    transactions: financials.transactions.map((t) =>
                                      t.recurringId !== r.id && t.extraForRecurringId !== r.id ? t : {
                                        ...t,
                                        ...(t.recurringId === r.id ? { recurringId: undefined, cycleDate: null } : {}),
                                        ...(t.extraForRecurringId === r.id ? { extraForRecurringId: undefined } : {}),
                                        updatedAt: new Date().toISOString(),
                                      }
                                    ),
                                  });
                                }}
                                aria-label="Delete recurring payment"
                                className="text-xs"
                                style={{ color: T.coral }}
                              >✕</button>
                            </div>
                          </div>
                        </div>
                        {/* Extra payment inline form */}
                        {isAddingExtra && (
                          <div className="mt-2 pt-2 space-y-2" style={{ borderTop: `1px solid ${T.line}` }}>
                            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>
                              Log extra payment this {noun}
                            </p>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <MoneyInput
                                  value={extraRecAmt}
                                  onChange={setExtraRecAmt}
                                  placeholder="Extra amount"
                                  max={moneyMaxFor(r.currency, lbpRate)}
                                />
                              </div>
                              <button
                                onClick={() => logExtraPayment(r)}
                                className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
                                style={{ background: T.jade, color: T.ink }}
                              >
                                Log
                              </button>
                              <button
                                onClick={() => setExtraRecId(null)}
                                aria-label="Cancel extra payment"
                                className="px-2 py-1.5 rounded-xl text-xs transition-all hover:opacity-70"
                                style={{ color: T.mute }}
                              >✕</button>
                            </div>
                            <p className="text-[10px]" style={{ color: T.mute }}>
                              Logged as a transaction in {b.label} · {cur} this {noun}.
                            </p>
                          </div>
                        )}
                        {/* Confirm inline form (2.4.30, finding A) -- date actually paid, defaults to the cycle's own due date */}
                        {isConfirming && target && (
                          <div className="mt-2 pt-2 space-y-2" style={{ borderTop: `1px solid ${T.line}` }}>
                            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>
                              Confirm payment
                            </p>
                            <div className="flex gap-2 items-end">
                              <div className="flex-1">
                                <Label htmlFor={`confirm-date-${r.id}`}>Date actually paid</Label>
                                <DateFieldDMY id={`confirm-date-${r.id}`} value={confirmDate} onChange={setConfirmDate} />
                              </div>
                              <button
                                onClick={() => {
                                  onConfirmRecurring?.(r.id, confirmDate ? new Date(confirmDate) : undefined);
                                  setConfirmingRecId(null);
                                }}
                                className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
                                style={{ background: T.jade, color: T.ink }}
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmingRecId(null)}
                                aria-label="Cancel confirm"
                                className="px-2 py-1.5 rounded-xl text-xs transition-all hover:opacity-70"
                                style={{ color: T.mute }}
                              >✕</button>
                            </div>
                            {(() => {
                              // 2.4.36: a confirmed transaction's date can land a month away
                              // from the cycle it settles with nothing surfacing the mismatch
                              // until the edit form is opened -- warn live, here, at the one
                              // point where it's still easy to fix. Warns, doesn't block: a
                              // genuinely late/early payment across a month boundary stays
                              // fully legitimate.
                              const dueYm = cycleKeyForISO(target.dueDate.toISOString(), startDay);
                              const diverges = !!confirmDate && cycleKeyForISO(confirmDate, startDay) !== dueYm;
                              // dueYm is a cycle key (cycleKeyForISO, line above).
                              const dueMonthLabel = cycleLabel(dueYm, startDay);
                              return (
                                <p className="text-[10px]" style={{ color: diverges ? T.brass : T.mute }}>
                                  {diverges
                                    ? `⚠ This settles the ${dueMonthLabel} cycle, but you're dating it a different month.`
                                    : `Due ${fmtDate(target.dueDate.toISOString().slice(0, 10))} · defaults to the due date if left as-is.`}
                                </p>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div
                  className="flex justify-between items-center text-xs px-3 py-2 rounded-xl"
                  style={{ background: T.ink, color: T.mute }}
                >
                  <span>{recs.length} recurring</span>
                  <span className="font-semibold tabular-nums" style={{ color: T.text }}>
                    ${Math.round(totalMonthly).toLocaleString("en-US")}<span style={{ color: T.mute }}>/mo total</span>
                  </span>
                </div>
              </div>
            )}

            {recs.length === 0 && (
              <div
                className="rounded-xl px-4 py-6 text-center mb-2"
                style={{ background: T.panelSoft, border: `1px dashed ${T.line}` }}
              >
                <p className="text-2xl mb-1">🔁</p>
                <p className="text-xs" style={{ color: T.mute }}>Rent, subscriptions, loan payments…</p>
              </div>
            )}

            {/* Add form */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
              <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>New recurring payment</p>

              <div className="flex gap-2">
                <div style={{ width: 68 }}>
                  <Label htmlFor="new-rec-emoji">Icon</Label>
                  <FocusInput id="new-rec-emoji" value={rEmoji} onChange={(e) => setREmoji(e.target.value)} placeholder="🔁" />
                </div>
                <div className="flex-1">
                  <Label htmlFor="new-rec-name">Name</Label>
                  <FocusInput id="new-rec-name" value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Rent, Netflix, gym…" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="new-rec-amount">Amount</Label>
                  <MoneyInput id="new-rec-amount" value={rAmount} onChange={setRAmount} placeholder="0" max={moneyMaxFor(rCurrency, lbpRate)} />
                </div>
                <div>
                  <Label htmlFor="new-rec-freq">Frequency</Label>
                  <select
                    id="new-rec-freq"
                    value={rFreq}
                    onChange={(e) => setRFreq(e.target.value as RecurringFrequency)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm"
                    style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
                  >
                    {(Object.keys(FREQ_LABELS) as RecurringFrequency[]).map((f) => (
                      <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label>Currency</Label>
                <CurrencyToggle value={rCurrency} onChange={setRCurrency} />
              </div>

              <div>
                <Label>Type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {BUCKETS.map((b) => (
                    <button
                      key={b.value}
                      onClick={() => setRBucket(b.value)}
                      className="flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition-all duration-150"
                      style={{
                        background: rBucket === b.value ? b.color + "22" : T.panelSoft,
                        border: `1px solid ${rBucket === b.value ? b.color : T.line}`,
                        color: rBucket === b.value ? b.color : T.mute,
                      }}
                    >
                      <span>{b.icon}</span>
                      <span>{b.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="new-rec-category">Category</Label>
                <select
                  id="new-rec-category"
                  value={rCategory}
                  onChange={(e) => setRCategory(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
                >
                  <option value="">No category</option>
                  <CategoryOptions customCategories={financials.customCategories} />
                </select>
              </div>

              <div>
                <Label htmlFor="new-rec-start">Start date</Label>
                <DateFieldDMY id="new-rec-start" value={rStart} onChange={setRStart} />
              </div>

              <div>
                <Label>Ends</Label>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  {(["infinite", "date", "amount"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setREndType(t)}
                      className="py-2 rounded-xl text-xs font-medium transition-all"
                      style={{
                        background: rEndType === t ? T.jade + "22" : T.panelSoft,
                        border: `1px solid ${rEndType === t ? T.jade : T.line}`,
                        color: rEndType === t ? T.jade : T.mute,
                      }}
                    >
                      {t === "infinite" ? "∞ Never" : t === "date" ? "📅 By date" : "💰 By amount"}
                    </button>
                  ))}
                </div>
                {rEndType === "date" && (
                  <DateFieldDMY value={rEnd} onChange={setREnd} />
                )}
                {rEndType === "amount" && (
                  <div>
                    <MoneyInput
                      value={rTotalAmount}
                      onChange={setRTotalAmount}
                      placeholder="Total amount e.g. 10,000"
                      max={moneyMaxFor(rCurrency, lbpRate)}
                    />
                    {rAmount && rTotalAmount && (
                      <p className="text-[10px] mt-1 px-1 tabular-nums" style={{ color: T.mute }}>
                        ≈ <span style={{ color: T.jade }}>
                          {Math.ceil(parseFloat(rTotalAmount.replace(/,/g, "")) / parseFloat(rAmount.replace(/,/g, "")))} payments
                          · {(Math.ceil(parseFloat(rTotalAmount.replace(/,/g, "")) / parseFloat(rAmount.replace(/,/g, ""))) / FREQ_MONTHLY[rFreq]).toFixed(1)} months
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {rAmount && (
                <p className="text-[10px] tabular-nums px-1" style={{ color: T.mute }}>
                  ≈ <span style={{ color: T.jade }}>{rCurrency === "LBP" ? "L£" : "$"}{(parseFloat(rAmount.replace(/,/g, "") || "0") * FREQ_MONTHLY[rFreq]).toFixed(2)}/month</span>
                </p>
              )}

              <PrimaryBtn onClick={addRecurring} color={T.jade} disabled={!rName.trim() || !rAmount || !rStart}>+ Add recurring</PrimaryBtn>
            </div>
          </>
        );
      })()}
    </>
  );
}
