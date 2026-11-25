"use client";

import { useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { todayISO, capacityFreedFrom, committedMonthlyUSD, FREQ_MONTHLY, nominalMonthlyEquivalent, nextConfirmTarget, isCycleConfirmed, remainingInstallments, FREQ_LABELS, categoryLabel, categoryIcon, fmtDate, makeToUSDLive } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, money, fmtCur } from "./shared";
import { calendarDayOf } from "../../lib/calendarDay";
import { billHints, addBillAsRecurring, setBillAside, undoBillAside, BILL_TEXT, type BillHint } from "../../lib/billHints";
import type { computeDashboard } from "../../lib/computeDashboard";
import { LOGGED_TEXT, type LoggedEntry } from "../../lib/alreadyLogged";
import { useLoggedLink, LinkedNotice, FoundLine, foundLineId, choiceStyles, type LinkLogged } from "../LoggedLink";

type Renewal = ReturnType<typeof computeDashboard>["upcomingRenewals"][number];

/**
 * U2 (owner, session 33, DECISIONS_PENDING 19 (a)): the reminder's "Review" leads here, so each upcoming item
 * says when it's due, in Renewing soon's words, with Renewing soon's Confirm (the same handler, from the page).
 */
export default function RecurringScreen({ financials, onEdit, renewals, onConfirm, loggingIds, justConfirmedIds, onChange, found, onLink, onUnlink }: {
  financials: LocalFinancials; onEdit: (id: string) => void;
  renewals?: Renewal[]; onConfirm?: (id: string) => unknown; loggingIds?: Set<string>; justConfirmedIds?: Set<string>;
  /** Session 62: the page's save, for "Bills you log by hand" (without it the card isn't shown). */
  onChange?: (d: LocalFinancials) => unknown;
  /** TODO 124: the entry already logged by hand for each renewal's cycle (lib/alreadyLogged.ts), by item id. */
  found?: Record<string, LoggedEntry>;
  /** Links that entry to the cycle instead of logging a new payment ("Already logged"); and its Undo. */
  onLink?: LinkLogged;
  onUnlink?: LinkLogged;
}) {
  const T    = useTheme();
  const logged = useLoggedLink(onLink, onUnlink);
  const now  = new Date();
  // The recurring engine takes calendar days: today, on this device.
  const today = calendarDayOf(now);
  const toUSD   = makeToUSDLive(financials);
  const BC   = { NEEDS: T.sky, WANTS: T.brass, SAVINGS: T.jade } as const;
  const BL   = { NEEDS: "Needs", WANTS: "Wants", SAVINGS: "Savings" } as const;

  // Session 62: "Bills you log by hand". A hint acted on stays in its place ("... is now recurring", "... won't be
  // suggested again" with Undo) until the screen is left; the live hints no longer include it.
  const [done, setDone] = useState<Record<string, { hint: BillHint; kind: "added" | "aside"; firstDue?: string }>>({});
  const live = billHints(financials, todayISO()).filter((h) => !done[h.key]);
  const billRows = [...live.map((hint) => ({ hint, done: undefined })), ...Object.values(done).map((d) => ({ hint: d.hint, done: d }))]
    .sort((a, b) => (a.hint.lastDate !== b.hint.lastDate ? (a.hint.lastDate < b.hint.lastDate ? 1 : -1) : a.hint.name.localeCompare(b.hint.name)));
  const addBill = (hint: BillHint) => {
    if (!onChange) return;
    const { data, item } = addBillAsRecurring(financials, hint, todayISO());
    setDone((d) => ({ ...d, [hint.key]: { hint, kind: "added", firstDue: item.startDate } }));
    onChange(data);
  };
  const setAside = (hint: BillHint) => {
    if (!onChange) return;
    setDone((d) => ({ ...d, [hint.key]: { hint, kind: "aside" } }));
    onChange(setBillAside(financials, hint.key));
  };
  const undoAside = (hint: BillHint) => {
    if (!onChange) return;
    setDone((d) => { const next = { ...d }; delete next[hint.key]; return next; });
    onChange(undoBillAside(financials, hint.key));
  };

  // "Committed monthly" is a stable, informational figure -- what you're on
  // the hook for -- so it deliberately uses the nominal (payment-status-
  // independent) cost, not the paid-this-cycle-suppressed one budget/spend
  // math elsewhere uses. Otherwise this number (and every row's price below)
  // dips to $0 the moment a bill gets logged as paid, making an active
  // subscription look cancelled until next cycle.
  const totalMonthly = committedMonthlyUSD(financials, now); // P3-A (session 33): the one total, shared with Projections

  // Approved in session 34 (owner, session 33, P3-C with U2): the next 12 months of commitments. An item counts in a
  // month from its start date until capacityFreedFrom (an end date, or a total paid off) -- the same rule
  // Projections' "Looking ahead" uses -- at its nominal monthly cost, in USD at today's rate.
  const freedDayOf = new Map(financials.recurring.map((r) => [r.id, capacityFreedFrom(r, financials.transactions, financials, today)?.toISOString().slice(0, 10) ?? null]));
  const forward = Array.from({ length: 12 }, (_, i) => {
    const first = calendarDayOf(new Date(now.getFullYear(), now.getMonth() + i, 1));
    const next = calendarDayOf(new Date(now.getFullYear(), now.getMonth() + i + 1, 1));
    const active = financials.recurring.filter((r) => { const f = freedDayOf.get(r.id); return r.startDate < next && (f === null || f === undefined || f > first); });
    return {
      label: new Date(now.getFullYear(), now.getMonth() + i, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
      committedUSD: active.reduce((s, r) => s + toUSD(r.amount * FREQ_MONTHLY[r.frequency], r.currency), 0),
      starts: financials.recurring.filter((r) => r.startDate >= first && r.startDate < next).map((r) => r.name),
      ends: financials.recurring.filter((r) => { const f = freedDayOf.get(r.id); return !!f && f >= first && f < next; }).map((r) => r.name),
    };
  });

  const buckets = (["NEEDS","WANTS","SAVINGS"] as const).map((b) => ({
    bucket: b,
    items: financials.recurring.filter((r) => r.bucket === b),
    total: financials.recurring.filter((r) => r.bucket === b)
      .reduce((s, r) => s + toUSD(nominalMonthlyEquivalent(r, financials.transactions, financials, now), r.currency), 0),
  }));

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Recurring</h1>
        </div>

        {/* Session 62 ("Bills you log by hand", lib/billHints.ts; all wording approved): bills logged by hand every
            month, each offered as a recurring item or set aside. What was done stays in place until the screen is left. */}
        {onChange && billRows.length > 0 && (
          <section aria-labelledby="bill-hints-heading" className="rounded-2xl px-5 py-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <h2 id="bill-hints-heading" className="text-xs uppercase tracking-widest mb-1" style={{ color: T.mute }}>{BILL_TEXT.heading}</h2>
            <p className="text-xs mb-3" style={{ color: T.mute }}>{BILL_TEXT.lead}</p>
            <ul className="space-y-3">
              {billRows.map(({ hint, done }, i) => (
                <li key={hint.key} className="text-sm">
                  {done?.kind === "added" ? (
                    <p style={{ color: T.text }}>{BILL_TEXT.added(hint.name, fmtDate(done.firstDue))}</p>
                  ) : done?.kind === "aside" ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <p style={{ color: T.text }}>{BILL_TEXT.setAside(hint.name)}</p>
                      <button type="button" onClick={() => undoAside(hint)} className="text-xs font-semibold px-3 py-1.5 rounded-full"
                        style={{ border: `1px solid ${T.line}`, color: T.text }}>{BILL_TEXT.undo}</button>
                    </div>
                  ) : (
                    <>
                      <p id={`bill-hint-${i}`} style={{ color: T.text }}>{hint.name}</p>
                      <p className="text-xs" style={{ color: T.mute }}>{BILL_TEXT.about(fmtCur(hint.amount, hint.currency), fmtDate(hint.lastDate))}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button type="button" onClick={() => addBill(hint)} aria-describedby={`bill-hint-${i}`} className="text-xs font-semibold px-3 py-1.5 rounded-full"
                          style={{ background: T.jade, color: T.ink }}>{BILL_TEXT.add}</button>
                        <button type="button" onClick={() => setAside(hint)} aria-describedby={`bill-hint-${i}`} className="text-xs px-3 py-1.5 rounded-full"
                          style={{ border: `1px solid ${T.line}`, color: T.text }}>{BILL_TEXT.notABill}</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {financials.recurring.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm" style={{ color: T.mute }}>No recurring items yet. Add them in My Finances.</p>
          </div>
        ) : (
          <>
            {/* Total */}
            <div className="rounded-2xl px-5 py-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Total committed monthly</p>
              <p className="text-4xl font-medium tabular-nums mt-1" style={{ ...SERIF, color: T.text }}>{money(totalMonthly)}</p>
            </div>

            {/* By bucket */}
            {buckets.map(({ bucket, items, total }) => items.length > 0 && (
              <div key={bucket}>
                <div className="flex justify-between items-baseline mb-2 px-1">
                  <p className="text-xs uppercase tracking-widest" style={{ color: BC[bucket] }}>{BL[bucket]}</p>
                  <p className="text-xs tabular-nums" style={{ color: T.mute }}>{money(total)}/mo</p>
                </div>
                <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.line}` }}>
                  {items.map((r, i) => {
                    const monthly = toUSD(nominalMonthlyEquivalent(r, financials.transactions, financials, now), r.currency);
                    const target = nextConfirmTarget(r, financials.transactions, financials, today);
                    const overdue = (target?.overdueCount ?? 0) > 0;
                    const paidThisCycle = target ? isCycleConfirmed(r, target.dueDate, financials.transactions) : false;
                    const remaining = remainingInstallments(r, financials.transactions, financials, today);
                    const due = renewals?.find((x) => x.id === r.id);
                    // TODO 124: an entry logged by hand for the due cycle: "Already logged" leads, Confirm is outlined (the reminder's rule).
                    const entry = due && onLink ? found?.[r.id] : undefined;
                    const linkedHere = logged.linked?.recurringId === r.id;
                    const { filled, outlined } = choiceStyles(T);
                    return (
                      <div
                        key={r.id}
                        className="flex items-center gap-3 px-4 py-3 group"
                        style={{ background: T.panel, borderTop: i > 0 ? `1px solid ${T.line}` : undefined }}
                      >
                        <span className="text-xl">{r.emoji}</span>
                        <div className="flex-1">
                          <p className="text-sm flex items-center gap-1.5" style={{ color: T.text }}>
                            {r.name}
                            {overdue && !due && (
                              <span className="text-[9px] uppercase tracking-wider" style={{ color: T.coral }}>overdue{target!.overdueCount > 1 ? ` ×${target!.overdueCount}` : ""}</span>
                            )}
                            {!overdue && paidThisCycle && (
                              <span className="text-[9px] uppercase tracking-wider" style={{ color: T.jade }}>✓ paid</span>
                            )}
                            <button
                              onClick={() => onEdit(r.id)}
                              aria-label="Edit recurring payment"
                              className="text-[10px] px-1.5 py-0.5 rounded transition-all opacity-70 hover:!opacity-100"
                              style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                            >✎</button>
                          </p>
                          <p className="text-[10px]" style={{ color: T.mute }}>
                            {fmtCur(r.amount, r.currency)} · {FREQ_LABELS[r.frequency]}
                            {r.category && ` · ${categoryIcon(r.category, financials.customCategories)} ${categoryLabel(r.category, financials.customCategories)}`}
                            {remaining && ` · ${remaining.count} left, ends ${fmtDate(remaining.endsOn.toISOString().slice(0, 10))}`}
                          </p>
                          {due && (
                            <p className="text-[11px] flex flex-wrap items-center gap-2 mt-1">
                              <span className="whitespace-nowrap" style={{ color: due.overdueCount > 0 || due.dueInDays <= 2 ? T.coral : T.brass, fontWeight: due.overdueCount > 0 ? 600 : undefined }}>
                                {due.overdueCount > 0 ? `${due.overdueCount} overdue` : due.dueInDays === 0 ? "today" : due.dueInDays === 1 ? "tomorrow" : `in ${due.dueInDays}d`}
                              </span>
                              {entry && due && (
                                <button
                                  type="button"
                                  onClick={() => logged.link(r.id, r.name, entry, due.dueDate)}
                                  disabled={logged.busy}
                                  aria-describedby={foundLineId("recurring", r.id)}
                                  className="text-[10px] font-semibold px-2 py-1 rounded-full transition-all hover:opacity-80 disabled:opacity-40"
                                  style={filled}
                                >
                                  {LOGGED_TEXT.already}
                                </button>
                              )}
                              {onConfirm && (
                                <button
                                  onClick={() => { logged.clear(); onConfirm(r.id); }}
                                  disabled={loggingIds?.has(r.id)}
                                  className={`text-[10px] ${entry ? "" : "font-semibold "}px-2 py-1 rounded-full transition-all hover:opacity-80 disabled:opacity-40 disabled:hover:opacity-40`}
                                  style={entry ? outlined : { background: T.jade + "22", color: T.jade }}
                                  title={`Confirm this ${r.name} payment`}
                                >
                                  {loggingIds?.has(r.id) ? "Confirming…" : justConfirmedIds?.has(r.id) ? "Confirmed ✓" : "Confirm"}
                                </button>
                              )}
                            </p>
                          )}
                          {entry && <FoundLine id={foundLineId("recurring", r.id)} entry={entry} className="text-[11px] mt-1" />}
                          {(entry || linkedHere) && (
                            <LinkedNotice text={linkedHere ? logged.linked!.text : ""} busy={logged.busy} onUndo={onUnlink ? logged.undo : undefined} className={linkedHere ? "mt-1" : ""} />
                          )}
                        </div>
                        <p className="text-sm font-medium tabular-nums" style={{ color: BC[bucket] }}>
                          {money(monthly)}/mo
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Approved in session 34 (owner, session 33, P3-C) */}
            <div className="rounded-2xl px-5 py-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: T.mute }}>The next 12 months</h2>
              <ul className="space-y-1.5">
                {forward.map((m) => (
                  <li key={m.label} className="text-sm">
                    <span className="tabular-nums" style={{ color: T.text }}>{`${m.label}: ${money(m.committedUSD)} committed`}</span>
                    {[...m.starts.map((n) => `${n} starts`), ...m.ends.map((n) => `${n} ends`)].map((c) => (
                      <span key={c} className="block text-[11px]" style={{ color: T.brass }}>{c}</span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
