"use client";

import { useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";

export default function Field({
  label, type = "text", value, onChange, placeholder, autoComplete,
}: {
  label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; autoComplete?: string;
}) {
  const T = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest mb-1.5 font-medium" style={{ color: T.mute }}>
        {label}
      </label>
      <div className="relative">
        <input
          type={isPassword && revealed ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          // type="password" is exempt from mobile autocapitalize/autocorrect
          // by default, but flipping to type="text" for the reveal toggle
          // below loses that exemption — a phone keyboard would then be
          // free to capitalize the first character or autocorrect a word
          // mid-password, silently submitting a different string than what
          // was typed. Applies to every field here, not just password, since
          // none of email/name/amount should ever be autocorrected either.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full rounded-xl px-4 py-3 text-sm transition-all duration-150"
          style={{
            background: T.panelSoft,
            border: `1px solid ${focused ? T.jade : T.line}`,
            color: T.text,
            outline: "none",
            boxShadow: focused ? `0 0 0 3px ${T.jade}28` : "none",
            colorScheme: "dark",
            paddingRight: isPassword ? 52 : undefined,
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-wide hover:opacity-70 transition-opacity"
            style={{ color: T.mute }}
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </div>
  );
}
