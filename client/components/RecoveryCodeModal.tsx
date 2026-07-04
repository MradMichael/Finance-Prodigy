"use client";

import { useState } from "react";
import { useTheme } from "../contexts/ThemeContext";

/**
 * Shown exactly once, right after a recovery code is generated (sign-up,
 * first sign-in after migration, or a completed recovery). The code is
 * never stored anywhere retrievable — if the user doesn't save it now,
 * it's gone, so this blocks continuing until they've explicitly confirmed.
 */
export default function RecoveryCodeModal({
  code,
  onContinue,
}: {
  code: string;
  onContinue: () => void;
}) {
  const T = useTheme();
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-7 shadow-2xl"
        style={{ background: T.panel, border: `1px solid ${T.line}` }}
      >
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.brass }}>
          Save your recovery code
        </p>
        <h2 className="text-lg mt-1 mb-3" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
          This is shown once
        </h2>
        <p className="text-xs mb-5" style={{ color: T.mute }}>
          If you ever forget your password, this code is the only way back into your data — there&apos;s no email reset.
          Write it down or save it in a password manager now.
        </p>

        <div
          className="rounded-xl px-4 py-4 mb-4 text-center font-mono text-lg tracking-wider select-all"
          style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.jade }}
        >
          {code}
        </div>

        <button
          onClick={copy}
          className="w-full py-2.5 rounded-xl text-xs font-semibold mb-4 transition-all hover:opacity-80"
          style={{ background: T.panelSoft, color: T.text, border: `1px solid ${T.line}` }}
        >
          {copied ? "Copied ✓" : "Copy to clipboard"}
        </button>

        <label className="flex items-start gap-2.5 mb-5 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xs" style={{ color: T.mute }}>I&apos;ve saved this code somewhere safe.</span>
        </label>

        <button
          onClick={onContinue}
          disabled={!confirmed}
          className="w-full py-3 rounded-xl text-sm font-semibold tracking-wide transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
          style={{ background: T.jade, color: T.ink }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
