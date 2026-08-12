"use client";

import { useState, useEffect, useRef } from "react";
import type { Currency } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  const T = useTheme();
  return (
    <label htmlFor={htmlFor} className="block text-[10px] uppercase tracking-widest mb-1.5 font-medium" style={{ color: T.mute }}>
      {children}
    </label>
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
  value, onChange, placeholder, style, id,
}: {
  value: string; onChange: (raw: string) => void; placeholder?: string; style?: React.CSSProperties; id?: string;
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
      id={id}
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

export function PrimaryBtn({ onClick, children, color, small, disabled }: {
  onClick: () => void; children: React.ReactNode; color?: string; small?: boolean; disabled?: boolean;
}) {
  const T = useTheme();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${small ? "px-3 py-1.5" : "w-full py-2.5"} rounded-xl text-sm font-semibold tracking-wide transition-all duration-150 hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:pointer-events-none`}
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
          aria-pressed={value === c}
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
 *
 * Three separate DD / MM / YYYY segments, not one auto-formatting text
 * field. A single field that rewrites its own value on every keystroke
 * (inserting "/" as you type) yanks the cursor to the end on every
 * render, so fixing a typo in the middle — or even just backspacing —
 * feels broken. Segments avoid that class of bug entirely: each one is
 * short enough that the cursor position is never ambiguous.
 */
export function DateFieldDMY({
  value, onChange, style, id,
}: {
  value: string; // YYYY-MM-DD, or "" for empty
  onChange: (iso: string) => void;
  style?: React.CSSProperties;
  id?: string; // applied to the day segment — the field's first tab stop — so a paired <label htmlFor> at least lands somewhere in the group
}) {
  const T = useTheme();
  const [focused, setFocused] = useState(false);
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");

  const dayRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);

  // Stay in sync if the value changes from outside (e.g. loading a record to edit).
  useEffect(() => {
    const [y, m, d] = value ? value.split("-") : ["", "", ""];
    setDay(d ?? "");
    setMonth(m ?? "");
    setYear(y ?? "");
  }, [value]);

  function commit(d: string, m: string, y: string) {
    if (d.length !== 2 || m.length !== 2 || y.length !== 4) return;
    const dd = parseInt(d, 10), mm = parseInt(m, 10), yy = parseInt(y, 10);
    // Day/month range alone lets through calendar-impossible dates like
    // Feb 31 or Apr 31 — new Date(yy, mm, 0) gives the target month's
    // actual last day (accounting for leap years).
    const daysInMonth = mm >= 1 && mm <= 12 ? new Date(yy, mm, 0).getDate() : 31;
    if (dd > daysInMonth) {
      // Same "clamp instead of silently reject" rule the day/month range
      // clamping above already follows — used to just skip onChange here,
      // leaving the day box showing e.g. "31" on an April date forever with
      // no feedback that nothing had actually been saved.
      const clamped = String(daysInMonth).padStart(2, "0");
      setDay(clamped);
      onChange(`${y}-${m}-${clamped}`);
      return;
    }
    if (dd < 1) {
      setDay("01");
      onChange(`${y}-${m}-01`);
      return;
    }
    onChange(`${y}-${m}-${d}`);
  }

  // Auto-advance once a segment is full, or as soon as no valid second
  // digit could follow (e.g. day "4" can only ever be "04"-"09", never
  // "4X", so there's no reason to make the user type a leading zero).
  // Day/month are also clamped to their max (e.g. "13" as a month becomes
  // "12") instead of silently accepting an out-of-range value that would
  // just never get committed — typing 13/13/2026 used to look accepted
  // with no feedback that nothing was actually saved.
  function makeHandler(maxLen: number, maxValue: number, setter: (v: string) => void, next?: React.RefObject<HTMLInputElement>) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      let digits = e.target.value.replace(/\D/g, "").slice(0, maxLen);
      if (maxLen === 2 && digits.length === 2 && parseInt(digits, 10) > maxValue) {
        digits = String(maxValue).padStart(2, "0");
      }
      setter(digits);
      if (setter === setDay) commit(digits, month, year);
      else if (setter === setMonth) commit(day, digits, year);
      else commit(day, month, digits);

      const noSecondDigitPossible = maxLen === 2 && digits.length === 1 && parseInt(digits, 10) > Math.floor(maxValue / 10);
      if (next && (digits.length === maxLen || noSecondDigitPossible)) next.current?.focus();
    };
  }

  function handleBackspace(e: React.KeyboardEvent<HTMLInputElement>, current: string, prev?: React.RefObject<HTMLInputElement>, prevValue?: string, prevSetter?: (v: string) => void) {
    if (e.key === "Backspace" && current === "" && prev && prevSetter && prevValue !== undefined) {
      e.preventDefault();
      prevSetter(prevValue.slice(0, -1));
      prev.current?.focus();
    }
  }

  function handlePasteIntoDay(e: React.ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData("text").replace(/\D/g, "");
    if (digits.length < 4) return; // too short to be a pasted date — let default paste happen
    e.preventDefault();
    const d = digits.slice(0, 2), m = digits.slice(2, 4), y = digits.slice(4, 8);
    setDay(d); setMonth(m); setYear(y);
    commit(d, m, y);
    (y.length === 4 ? yearRef : m.length === 2 ? monthRef : dayRef).current?.focus();
  }

  const segStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: T.text,
    outline: "none",
    textAlign: "center",
    colorScheme: "dark",
  };

  // A hidden native date input, used purely as a calendar picker widget —
  // its own text display is never shown (that's what caused the original
  // locale-mismatch bug), only its value on change, which the DOM always
  // reports as YYYY-MM-DD regardless of locale.
  function openPicker() {
    const el = nativeRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }

  return (
    <div
      className="w-full rounded-xl px-3 py-2.5 flex items-center gap-1 text-sm tabular-nums transition-all duration-150"
      style={{
        position: "relative",
        background: T.panelSoft,
        border: `1px solid ${focused ? T.jade : T.line}`,
        boxShadow: focused ? `0 0 0 3px ${T.jade}28` : "none",
        ...style,
      }}
    >
      <input
        ref={nativeRef}
        type="date"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
      />
      <input
        id={id}
        ref={dayRef}
        type="text"
        inputMode="numeric"
        value={day}
        onChange={makeHandler(2, 31, setDay, monthRef)}
        onPaste={handlePasteIntoDay}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => { if (![dayRef, monthRef, yearRef].some((r) => r.current === document.activeElement)) setFocused(false); }, 0)}
        placeholder="DD"
        maxLength={2}
        style={{ ...segStyle, width: "1.6em" }}
      />
      <span style={{ color: T.mute }}>/</span>
      <input
        ref={monthRef}
        type="text"
        inputMode="numeric"
        value={month}
        onChange={makeHandler(2, 12, setMonth, yearRef)}
        onKeyDown={(e) => handleBackspace(e, month, dayRef, day, setDay)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => { if (![dayRef, monthRef, yearRef].some((r) => r.current === document.activeElement)) setFocused(false); }, 0)}
        placeholder="MM"
        maxLength={2}
        style={{ ...segStyle, width: "1.6em" }}
      />
      <span style={{ color: T.mute }}>/</span>
      <input
        ref={yearRef}
        type="text"
        inputMode="numeric"
        value={year}
        onChange={makeHandler(4, 9999, setYear)}
        onKeyDown={(e) => handleBackspace(e, year, monthRef, month, setMonth)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => { if (![dayRef, monthRef, yearRef].some((r) => r.current === document.activeElement)) setFocused(false); }, 0)}
        placeholder="YYYY"
        maxLength={4}
        style={{ ...segStyle, width: "3em" }}
      />
      <button
        type="button"
        onClick={openPicker}
        aria-label="Pick date from calendar"
        className="ml-auto text-sm leading-none opacity-70 hover:opacity-100 transition-opacity"
        style={{ background: "transparent", border: "none", cursor: "pointer", color: T.mute, padding: "2px 4px" }}
      >
        📅
      </button>
    </div>
  );
}
