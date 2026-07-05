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
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest mb-1.5 font-medium" style={{ color: T.mute }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
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
        }}
      />
    </div>
  );
}
