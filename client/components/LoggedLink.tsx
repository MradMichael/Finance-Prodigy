"use client";

// TODO 124 (owner, session 64, item 3): the reminder's "Already logged" choice (TODO 121, approved in session 64) on
// the other Confirm buttons: the Overview's Renewing soon chips, Recurring's due line and the entry form's Confirm
// payment form. This holds what those three share: the link and its Undo, the notice that says so, and the button.
// The sentences are the reminder's (lib/alreadyLogged.ts, LOGGED_TEXT); nothing here adds one. The notice stays
// until Undo, the next answer there (`clear`), or the screen goes (each surface's own state): no timer, as on the
// reminder.
import { useState } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { fmtDate } from "../lib/localData";
import { LOGGED_TEXT, type LoggedEntry } from "../lib/alreadyLogged";
import { fmtCur } from "./screens/shared";

/** Links the entry to the cycle due on `dueDate`, or undoes that; true when it was stored. */
export type LinkLogged = (recurringId: string, txId: string, dueDate: string) => Promise<boolean>;
export interface Linked { recurringId: string; txId: string; dueDate: string; text: string }

export function useLoggedLink(onLink?: LinkLogged, onUnlink?: LinkLogged) {
  const [linked, setLinked] = useState<Linked | null>(null);
  const [busy, setBusy] = useState(false);
  async function link(recurringId: string, name: string, entry: LoggedEntry, dueDate: string): Promise<boolean> {
    if (!onLink) return false;
    setBusy(true);
    try {
      if (!(await onLink(recurringId, entry.txId, dueDate))) return false;
      setLinked({ recurringId, txId: entry.txId, dueDate, text: LOGGED_TEXT.linked(name, fmtDate(entry.date)) });
      return true;
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
  return { linked, busy, link, undo, clear: () => setLinked(null) };
}

/** The found line's id, so each "Already logged" is described by its own line where several are on one screen. */
export const foundLineId = (where: string, recurringId: string) => `logged-${where}-${recurringId}`;

/** "You logged {name} on {date} ({amount})." in the entry's own words, amount and currency. */
export function FoundLine({ id, entry, className = "text-xs" }: { id: string; entry: LoggedEntry; className?: string }) {
  const T = useTheme();
  return <p id={id} className={className} style={{ color: T.mute }}>{LOGGED_TEXT.found(entry.description, fmtDate(entry.date), fmtCur(entry.amount, entry.currency))}</p>;
}

/**
 * The notice after a link, with Undo. Always on the page, empty until there's something to say, as the reminder's is:
 * a live region added together with its text may not be read out.
 */
export function LinkedNotice({ text, busy, onUndo, className = "" }: { text: string; busy: boolean; onUndo?: () => void; className?: string }) {
  const T = useTheme();
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <p role="status" className="text-xs flex-1 min-w-0" style={{ color: T.jade }}>{text}</p>
      {text && onUndo && (
        <button type="button" disabled={busy} onClick={onUndo} className="text-xs px-3 py-1.5 rounded-full disabled:opacity-50"
          style={{ border: `1px solid ${T.line}`, color: T.mute }}>{LOGGED_TEXT.undo}</button>
      )}
    </div>
  );
}

/** The two looks the reminder uses when an entry is found: "Already logged" filled, the other answer outlined. */
export function choiceStyles(T: ReturnType<typeof useTheme>) {
  return { filled: { background: T.jade, color: T.ink }, outlined: { border: `1px solid ${T.line}`, color: T.mute } };
}
