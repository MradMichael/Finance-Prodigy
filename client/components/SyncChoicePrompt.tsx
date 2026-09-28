"use client";

import { useTheme } from "../contexts/ThemeContext";
import type { BackupChoice } from "../lib/syncService";

/**
 * The load-time backup choice for an account that has not made one (audit
 * 2.4.153, opt-in sync part 3).
 *
 * EXISTING ACCOUNTS MUST NOT SILENTLY STOP, AND MUST NOT SILENTLY BE KEPT.
 * Until now every signed-in session uploaded automatically. So an account
 * with a server copy is told that plainly and asked what happens next --
 * keep backing up, stop and delete the copy, or stop and keep it. It is
 * asked on its next open, and until it answers nothing uploads (the part 1
 * gate treats undecided as paused), so the upload neither continues behind
 * its back nor ends without its knowing.
 *
 * `hasServerCopy` is true if EITHER this device has synced before OR the
 * server reports a copy for this email. Either alone can be wrong -- a new
 * device has no local sync record; an offline check reports no copy -- and
 * the cost of the two errors is not symmetric: telling someone who has a
 * server copy that they have none would withhold the delete option. So the
 * prompt errs towards offering it.
 *
 * Blocking by design: no close button, no click-outside. The choice is the
 * point of the prompt.
 */
export default function SyncChoicePrompt({ hasServerCopy, busy, onChoose }: {
  hasServerCopy: boolean;
  busy: boolean;
  onChoose: (choice: BackupChoice) => void;
}) {
  const T = useTheme();
  const btn = (label: string, choice: BackupChoice, primary = false, danger = false) => (
    <button
      disabled={busy}
      onClick={() => onChoose(choice)}
      className="w-full px-4 py-2.5 rounded-xl text-sm text-left transition-all disabled:opacity-50"
      style={primary
        ? { background: T.jade, color: T.ink, fontWeight: 600 }
        : danger
          ? { color: T.coral, border: `1px solid ${T.coral}60` }
          : { color: T.text, border: `1px solid ${T.line}` }}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-choice-title"
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4"
        style={{ background: T.panel, border: `1px solid ${T.line}` }}
      >
        <h2 id="sync-choice-title" className="text-lg" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
          {hasServerCopy ? "Your data has been backed up automatically" : "Back up to ESSA's server?"}
        </h2>

        {hasServerCopy ? (
          <p className="text-sm leading-relaxed" style={{ color: T.mute }}>
            Until now, ESSA copied your data to its server automatically whenever you were signed in, without
            asking. That was never a choice you made, so it is paused until you make one. The server copy lets you
            sign in and restore on another device; it is protected by your password but is not end-to-end
            encrypted, so the server can read it.
          </p>
        ) : (
          <p className="text-sm leading-relaxed" style={{ color: T.mute }}>
            ESSA can keep a copy of your data on its server so you can sign in and restore it on another device.
            It is off unless you turn it on. The copy is protected by your password but is not end-to-end
            encrypted, so the server can read it.
          </p>
        )}

        <p className="text-xs leading-relaxed" style={{ color: T.mute }}>
          With backup off, your data stays in this browser only: you can&apos;t sign in on another device, and your
          recovery code only works on this device. You can change this later in Profile.
        </p>

        <div className="space-y-2">
          {hasServerCopy ? (
            <>
              {btn("Keep backing up", "on", true)}
              {btn("Stop, and delete the copy on the server", "off-delete", false, true)}
              {btn("Stop, but keep the existing copy (it will stop updating)", "off-keep")}
            </>
          ) : (
            <>
              {btn("Turn backup on", "on", true)}
              {btn("Keep it off", "off-keep")}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
