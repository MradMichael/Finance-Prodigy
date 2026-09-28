"use client";

import { useState } from "react";
import { useTheme } from "../contexts/ThemeContext";
import type { BackupChoice } from "../lib/syncService";

/**
 * The backup switch on Profile (audit 2.4.153, opt-in sync part 2).
 *
 * Off by default. Leaving it off has two real costs, and the switch states
 * both where the choice is made rather than in a help page: without a server
 * copy there is no signing in on a second device, and a recovery code only
 * works on the device that generated it -- both currently ride on the copy.
 *
 * Turning it off is a question, not an act: delete the copy on the server,
 * or keep it. Nothing is chosen until one of those is picked, and cancel
 * leaves backup on. What each answer DOES is applyBackupChoice's job; this
 * component only asks.
 */
export default function BackupSwitch({ on, busy, onChoose }: {
  on: boolean;
  busy: boolean;
  onChoose: (choice: BackupChoice) => void;
}) {
  const T = useTheme();
  const [askingOff, setAskingOff] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span id="backup-switch-label" className="text-sm" style={{ color: T.text }}>Automatic backup to ESSA&apos;s server</span>
        <button
          role="switch"
          aria-checked={on}
          aria-labelledby="backup-switch-label"
          disabled={busy || askingOff}
          onClick={() => (on ? setAskingOff(true) : onChoose("on"))}
          className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50"
          style={{ background: on ? T.jade : T.line }}
        >
          <span
            className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
            style={{ left: on ? "1.375rem" : "0.125rem", background: T.panel }}
          />
        </button>
      </div>

      {on ? (
        <p className="text-xs leading-relaxed" style={{ color: T.mute }}>
          On. Your data is copied to our server a few seconds after each change, so you can sign in and restore it on
          another device. That copy is protected by your password but is not end-to-end encrypted: the server can read it.
        </p>
      ) : (
        <p className="text-xs leading-relaxed" style={{ color: T.mute }}>
          Off. Your data stays in this browser only. Without a server copy you can&apos;t sign in on another device, and
          your recovery code only works on this device. Download my data (below) is the way to keep your own backup.
        </p>
      )}

      {askingOff && (
        <div className="rounded-xl p-3 space-y-2" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
          <p className="text-xs" style={{ color: T.text }}>Turn off automatic backup. What should happen to the copy already on our server?</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => { setAskingOff(false); onChoose("off-delete"); }}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-left"
              style={{ background: T.coral, color: T.ink }}
            >
              Turn off and delete the server copy
            </button>
            <button
              onClick={() => { setAskingOff(false); onChoose("off-keep"); }}
              className="px-3 py-2 rounded-lg text-xs text-left"
              style={{ color: T.text, border: `1px solid ${T.line}` }}
            >
              Turn off, keep the existing copy (it will stop updating)
            </button>
            <button
              onClick={() => setAskingOff(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-left"
              style={{ color: T.mute }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
