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
export default function ResetDataPanel({ counts, backupOn, onConfirm }: {
  counts: { transactions: number; goals: number; debts: number; recurring: number };
  backupOn: boolean;
  onConfirm: () => void;
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
      <p className="text-xs leading-relaxed" style={{ color: backupOn ? T.coral : T.mute }}>
        {backupOn
          // DI-13, DRAFT awaiting the owner: other devices now remove the
          // reset's entries (it records a deletion for each), but keep their
          // own settings, which aren't merged.
          ? "Backup is on, so this also replaces your backup on our server with the empty copy. Your other devices remove the same entries the next time they sync, but keep their own settings, such as income and payday."
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
