"use client";

import { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { fmtDate } from "../lib/localData";
import type { computeDashboard } from "../lib/computeDashboard";
import { LOGGED_TEXT, type LoggedEntry } from "../lib/alreadyLogged";
import { fmtCur } from "./screens/shared";

export type Renewal = ReturnType<typeof computeDashboard>["upcomingRenewals"][number];

/**
 * The in-app due-date reminder (owner's request, 2026-08-20; planned in session 30, wording approved
 * and built in session 31). A banner at the top of the main area, on every screen, when a recurring
 * item is due today or overdue. Not a modal: it takes no focus and blocks nothing.
 *
 * - One item: asks whether it's paid. Yes confirms it through the dashboard's own handler (Renewing
 *   soon's Confirm: buildRecurringConfirmLog at the due date nextConfirmTarget gives), so it writes
 *   exactly what Confirm writes; for an item with several outstanding cycles, that's the oldest, and
 *   the banner then asks about the next. Not yet hides that item until the app is next opened
 *   (component state only: nothing stored).
 * - Already logged (TODO 121; session 63, held for the owner): when a row the person logged by hand
 *   matches the cycle asked about (`found`, lib/alreadyLogged.ts), a line names it and "Already
 *   logged" leads: it links that row to the cycle (`onLink`) instead of logging a new one, then says
 *   so with Undo (`onUnlink`). That notice stays until Undo, the next answer, or a move to another
 *   screen (`resetKey`): no timer, since an Undo that vanishes is a timing barrier.
 * - Several items: a count and a way to the Recurring screen.
 * - Nothing while another prompt is on screen (`blocked`).
 * In-app only: no notifications, no service-worker change.
 */
export default function DueReminder({
  renewals, blocked, onConfirm, onReview, found, onLink, onUnlink, resetKey,
}: {
  renewals: Renewal[];
  blocked: boolean;
  /** Confirms the item's oldest outstanding cycle; true when the payment was stored. */
  onConfirm: (recurringId: string) => Promise<boolean>;
  onReview: () => void;
  /** The row already logged for each renewal's cycle, by item id. */
  found?: Record<string, LoggedEntry>;
  /** Links the row to the cycle due on `dueDate`; true when it was stored. */
  onLink?: (recurringId: string, txId: string, dueDate: string) => Promise<boolean>;
  /** Undoes that link; true when it was stored. */
  onUnlink?: (recurringId: string, txId: string, dueDate: string) => Promise<boolean>;
  /** The screen on show: the link's notice goes when it changes. */
  resetKey?: string;
}) {
  const T = useTheme();
  const [notYet, setNotYet] = useState<Set<string>>(() => new Set());
  const [logged, setLogged] = useState<string | null>(null);
  const [linked, setLinked] = useState<{ recurringId: string; txId: string; dueDate: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!logged) return;
    const t = setTimeout(() => setLogged(null), 4000);
    return () => clearTimeout(t);
  }, [logged]);
  useEffect(() => { setLinked(null); }, [resetKey]);

  const due = renewals.filter((r) => (r.overdueCount > 0 || r.dueInDays === 0) && !notYet.has(r.id));
  if (blocked || (due.length === 0 && !logged && !linked)) return null;

  const one = due.length === 1 ? due[0] : null;
  const entry = one && onLink ? found?.[one.id] ?? null : null;
  const amount = (r: Renewal) => fmtCur(r.amount, r.currency);
  const question = (r: Renewal) =>
    r.overdueCount > 1 ? `${r.name} has ${r.overdueCount} payments outstanding, the oldest due on ${fmtDate(r.dueDate)}. Is that one paid?`
      : r.overdueCount === 1 ? `${r.name} was due on ${fmtDate(r.dueDate)} (${amount(r)}). Is it paid?`
        : `${r.name} is due today (${amount(r)}). Is it paid?`;

  async function yes(r: Renewal) {
    setBusy(true);
    setLinked(null);
    try {
      if (await onConfirm(r.id)) setLogged(`Logged ${r.name}, ${amount(r)}.`);
    } finally {
      setBusy(false);
    }
  }

  async function already(r: Renewal, e: LoggedEntry) {
    if (!onLink) return;
    setBusy(true);
    try {
      if (await onLink(r.id, e.txId, r.dueDate)) {
        setLogged(null);
        setLinked({ recurringId: r.id, txId: e.txId, dueDate: r.dueDate, text: LOGGED_TEXT.linked(r.name, fmtDate(e.date)) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!linked || !onUnlink) return;
    setBusy(true);
    try {
      if (await onUnlink(linked.recurringId, linked.txId, linked.dueDate)) setLinked(null);
    } finally {
      setBusy(false);
    }
  }

  const filled = { background: T.jade, color: T.ink };
  const outlined = { border: `1px solid ${T.line}`, color: T.mute };
  return (
    <section role="region" aria-label="Payment reminder" className="mx-4 mt-4 md:mx-10 rounded-2xl px-4 py-3.5 space-y-2.5"
      style={{ background: T.panel, border: `1px solid ${T.brass}60` }}>
      {due.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm flex-1 min-w-0" style={{ color: T.text }}>{`${due.length} payments are due or overdue.`}</p>
          <button type="button" onClick={onReview} className="text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ background: T.jade + "22", color: T.jade }}>Review</button>
        </div>
      )}
      {one && (
        <div className="flex flex-wrap items-center gap-3">
          {/* With a row found, three buttons: the text keeps 12rem, so on a phone they wrap below it (session 63, live at 390). */}
          <div className={`flex-1 ${entry ? "min-w-[12rem]" : "min-w-0"} space-y-1`}>
            <p className="text-sm" style={{ color: T.text }}>
              <span aria-hidden="true">{one.emoji} </span>{question(one)}
            </p>
            {entry && (
              <p className="text-xs" style={{ color: T.mute }}>{LOGGED_TEXT.found(entry.description, fmtDate(entry.date), fmtCur(entry.amount, entry.currency))}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            {entry && (
              <button type="button" disabled={busy} onClick={() => already(one, entry)} className="text-xs font-semibold px-3 py-1.5 rounded-full disabled:opacity-50"
                style={filled}>{LOGGED_TEXT.already}</button>
            )}
            <button type="button" disabled={busy} onClick={() => yes(one)} className={`text-xs ${entry ? "" : "font-semibold "}px-3 py-1.5 rounded-full disabled:opacity-50`}
              style={entry ? outlined : filled}>Yes, it&apos;s paid</button>
            <button type="button" onClick={() => { setLinked(null); setNotYet((s) => new Set(s).add(one.id)); }} className="text-xs px-3 py-1.5 rounded-full"
              style={outlined}>Not yet</button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-xs flex-1 min-w-0" style={{ color: T.jade }}>{linked?.text ?? logged ?? ""}</p>
        {linked && onUnlink && (
          <button type="button" disabled={busy} onClick={undo} className="text-xs px-3 py-1.5 rounded-full disabled:opacity-50"
            style={outlined}>{LOGGED_TEXT.undo}</button>
        )}
      </div>
    </section>
  );
}
