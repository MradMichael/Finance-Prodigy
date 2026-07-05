"use client";

import { useState, useEffect } from "react";
import type { Currency } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";

export function Label({ children }: { children: React.ReactNode }) {
  const T = useTheme();
  return (
    <p className="text-[10px] uppercase tracking-widest mb-1.5 font-medium" style={{ color: T.mute }}>
      {children}
    </p>
  );
}

export function FocusInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const T = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e)  => { setFocused(false);  props.onBlur?.(e);  }}
      className="w-full rounded-xl px-3 py-2.5 text-sm transition-all duration-150"
      style={{
        background: T.panelSoft,
        border: `1px solid ${focused ? T.jade : T.line}`,
        color: T.text,
        outline: "none",
        boxShadow: focused ? `0 0 0 3px ${T.jade}28` : "none",
        colorScheme: "dark",
        ...props.style,
      }}
    />
  );
}

// Comma-formatted money input — stores raw number string, displays with commas
export function MoneyInput({
  value, onChange, placeholder, style,
}: {
  value: string; onChange: (raw: string) => void; placeholder?: string; style?: React.CSSProperties;
}) {
  const T = useTheme();
  const [focused, setFocused] = useState(false);

  function fmt(raw: string): string {
    if (!raw) return "";
    const [int, dec] = raw.split(".");
    const intFmt = parseInt(int || "0").toLocaleString("en-US");
    return dec !== undefined ? `${intFmt}.${dec}` : intFmt;
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/,/g, "").replace(/[^\d.]/g, "");
    const parts = raw.split(".");
    const clean = parts[0] + (parts.length > 1 ? "." + parts.slice(1).join("") : "");
    onChange(clean);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={focused ? value : fmt(value)}
      onChange={handleChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      className="w-full rounded-xl px-3 py-2.5 text-sm transition-all duration-150"
      style={{
        background: T.panelSoft,
        border: `1px solid ${focused ? T.jade : T.line}`,
        color: T.text,
        outline: "none",
        boxShadow: focused ? `0 0 0 3px ${T.jade}28` : "none",
        colorScheme: "dark",
        ...style,
      }}
    />
  );
}

export function PrimaryBtn({ onClick, children, color, small }: {
  onClick: () => void; children: React.ReactNode; color?: string; small?: boolean;
}) {
  const T = useTheme();
  return (
    <button
      onClick={onClick}
      className={`${small ? "px-3 py-1.5" : "w-full py-2.5"} rounded-xl text-sm font-semibold tracking-wide transition-all duration-150 hover:opacity-90 active:scale-95`}
      style={{ background: color ?? T.jade, color: T.ink }}
    >
      {children}
    </button>
  );
}

export function Section({
  title, icon, badge, children, defaultOpen = true,
}: {
  title: string; icon: string; badge?: number; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const T = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div style={{ height: 1, background: T.line }} />
      <button
        className="w-full flex items-center gap-2.5 py-3.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-base leading-none">{icon}</span>
        <span className="text-[10px] uppercase tracking-widest font-semibold flex-1" style={{ color: T.mute }}>
          {title}
        </span>
        {badge !== undefined && badge > 0 && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: T.brass + "30", color: T.brass }}
          >
            {badge}
          </span>
        )}
        <span
          className="text-xs transition-transform duration-200"
          style={{ color: T.mute, transform: open ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}
        >
          ▾
        </span>
      </button>
      {open && <div className="pb-5 space-y-3">{children}</div>}
    </div>
  );
}

export function CurrencyToggle({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  const T = useTheme();
  return (
    <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${T.line}` }}>
      {(["USD", "LBP"] as Currency[]).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className="flex-1 py-2 text-xs font-semibold transition-all"
          style={{
            background: value === c ? T.jade + "25" : T.panelSoft,
            color: value === c ? T.jade : T.mute,
            borderRight: c === "USD" ? `1px solid ${T.line}` : undefined,
          }}
        >
          {c === "USD" ? "$ USD" : "L£ LBP"}
        </button>
      ))}
    </div>
  );
}

/**
 * Custom DD/MM/YYYY date field — deliberately NOT a native
 * <input type="date">. Native pickers render in whatever locale the
 * browser resolves (MM/DD/YYYY on a US-locale system) and that can't be
 * reliably forced: the lang attribute works in some Chromium versions
 * but Firefox ignores it and follows the OS locale regardless. That
 * meant the picker could show "08/04/2026" right next to this app's own
 * DD/MM/YYYY displays showing "04/08/2026" for the exact same date —
 * looked like a bug even when it wasn't. This guarantees one format,
 * everywhere, in every browser, always.
 */
export function DateFieldDMY({
  value, onChange, style,
}: {
  value: string; // YYYY-MM-DD, or "" for empty
  onChange: (iso: string) => void;
  style?: React.CSSProperties;
}) {
  const T = useTheme();
  const [focused, setFocused] = useState(false);

  function toDisplay(iso: string): string {
    const [y, m, d] = iso ? iso.split("-") : [];
    return y && m && d ? `${d}/${m}/${y}` : "";
  }

  const [text, setText] = useState(() => toDisplay(value));

  // Stay in sync if the value changes from outside (e.g. loading a record to edit).
  useEffect(() => setText(toDisplay(value)), [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setText(formatted);

    if (digits.length === 8) {
      const day = digits.slice(0, 2), month = digits.slice(2, 4), year = digits.slice(4, 8);
      const d = parseInt(day, 10), m = parseInt(month, 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) onChange(`${year}-${month}-${day}`);
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={handleChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder="DD/MM/YYYY"
      maxLength={10}
      className="w-full rounded-xl px-3 py-2.5 text-sm tabular-nums transition-all duration-150"
      style={{
        background: T.panelSoft,
        border: `1px solid ${focused ? T.jade : T.line}`,
        color: T.text,
        outline: "none",
        boxShadow: focused ? `0 0 0 3px ${T.jade}28` : "none",
        colorScheme: "dark",
        ...style,
      }}
    />
  );
}
