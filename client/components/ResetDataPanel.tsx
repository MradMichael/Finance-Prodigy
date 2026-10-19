"use client";

import { useState } from "react";
import { useTheme } from "../contexts/ThemeContext";

/**
 * "Reset all data", moved from the My Finances footer to Profile's Danger
 * zone. It erases every financial record and keeps the account.
 *
 * The confirm used to say it "permanently erases every transaction, goal,
 * debt..." and stop there -- while auto-sync then overwrote the server copy
 * with the empty dataset a few seconds later. Now it says exactly which of
 * the two happens: with backup on, the backup on the server is replaced
 * too, and other devices receive the empty copy; with backup off, it is
 * this device only. And it names what is about to go, so the confirm is
 * about this account's data rather than a generic warning.
 */
export default function ResetDataPanel({ counts, backupOn, onConfirm, hasKeptCopy = false }: {
  counts: { transactions: number; goals: number; debts: number; recurring: number };
  backupOn: boolean;
  onConfirm: () => void;
  /** Session 24, item 1 (draft, held): this account has a copy kept of a record that couldn't be opened. */
  hasKeptCopy?: boolean;
}) {
  const T = useTheme();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
        style={{ background: T.coral + "18", color: T.coral, border: `1px solid ${T.coral}40` }}
      >
        Reset all data
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed" style={{ color: T.mute }}>
        This permanently erases {plural(counts.transactions, "transaction")}, {plural(counts.goals, "goal")},{" "}
        {plural(counts.debts, "debt")}, {plural(counts.recurring, "recurring item")}, and every card, asset and tracked
        balance. Your account stays, and so does your backup setting.
      </p>
      {/* Session 24, item 1 (DRAFT WORDING, HELD): Erase removes a kept copy too; its contents can't be counted. */}
      {hasKeptCopy && (
        <p className="text-xs leading-relaxed" style={{ color: T.mute }}>This also removes the copy kept of data this browser couldn&apos;t open.</p>
      )}
      <p className="text-xs leading-relaxed" style={{ color: backupOn ? T.coral : T.mute }}>
        {backupOn
          // Owner's wording (session 12): other devices remove the reset's
          // entries (it records a deletion for each) and take its settings,
          // keeping whatever each changed since its own last sync, judged by
          // its record (lib/reset-keeps-unsynced.test.ts).
          ? "Backup is on, so this also replaces your backup on our server with the empty copy. Your other devices are reset the same way the next time they sync, settings included, apart from changes a device hadn't backed up yet."
          : "Backup is off, so this happens only on this device. Nothing on our server changes."}
      </p>
      <label htmlFor="reset-confirm" className="block text-xs" style={{ color: T.mute }}>
        Type <strong style={{ color: T.coral }}>reset</strong> to confirm
      </label>
      <input
        id="reset-confirm"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="reset"
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
      />
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={typed.trim().toLowerCase() !== "reset"}
          className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 disabled:pointer-events-none"
          style={{ background: T.coral, color: T.ink }}
        >
          Erase everything
        </button>
        <button
          onClick={() => { setOpen(false); setTyped(""); }}
          className="px-4 py-2 rounded-xl text-sm"
          style={{ color: T.mute }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
