"use client";

import type { LocalFinancials } from "../../lib/localData";
import { capacityFreedFrom, committedMonthlyUSD, FREQ_MONTHLY, nominalMonthlyEquivalent, nextConfirmTarget, isCycleConfirmed, remainingInstallments, FREQ_LABELS, categoryLabel, categoryIcon, fmtDate, makeToUSDLive } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, money, fmtCur } from "./shared";
import { calendarDayOf } from "../../lib/calendarDay";
import type { computeDashboard } from "../../lib/computeDashboard";

type Renewal = ReturnType<typeof computeDashboard>["upcomingRenewals"][number];

/**
 * U2 (owner, session 33, DECISIONS_PENDING 19 (a)): the reminder's "Review" leads here, so each upcoming item
 * says when it's due, in Renewing soon's words, with Renewing soon's Confirm (the same handler, from the page).
 */
export default function RecurringScreen({ financials, onEdit, renewals, onConfirm, loggingIds, justConfirmedIds }: {
  financials: LocalFinancials; onEdit: (id: string) => void;
  renewals?: Renewal[]; onConfirm?: (id: string) => unknown; loggingIds?: Set<string>; justConfirmedIds?: Set<string>;
}) {
  const T    = useTheme();
  const now  = new Date();
  // The recurring engine takes calendar days: today, on this device.
  const today = calendarDayOf(now);
  const toUSD   = makeToUSDLive(financials);
  const BC   = { NEEDS: T.sky, WANTS: T.brass, SAVINGS: T.jade } as const;
  const BL   = { NEEDS: "Needs", WANTS: "Wants", SAVINGS: "Savings" } as const;

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
                              {onConfirm && (
                                <button
                                  onClick={() => onConfirm(r.id)}
                                  disabled={loggingIds?.has(r.id)}
                                  className="text-[10px] font-semibold px-2 py-1 rounded-full transition-all hover:opacity-80 disabled:opacity-40 disabled:hover:opacity-40"
                                  style={{ background: T.jade + "22", color: T.jade }}
                                  title={`Confirm this ${r.name} payment`}
                                >
                                  {loggingIds?.has(r.id) ? "Confirming…" : justConfirmedIds?.has(r.id) ? "Confirmed ✓" : "Confirm"}
                                </button>
                              )}
                            </p>
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
