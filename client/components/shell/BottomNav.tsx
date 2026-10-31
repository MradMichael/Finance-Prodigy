"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { NAV, type Screen } from "../screens/shared";

// U1 (owner, session 33, DECISIONS_PENDING 16 (a); "More" approved): the bar holds four screens and More,
// which opens every screen in a panel above it. It held all sixteen in a sideways-scrolling strip, seven
// visible, with nothing to say more existed.
const FIXED: Screen[] = ["overview", "finances", "transactions", "goals"];
const PANEL_ID = "bottom-nav-more";

export default function BottomNav({ screen, setScreen }: { screen: Screen; setScreen: (s: Screen) => void }) {
  const T = useTheme();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  // Escape and a tap outside close the panel; Escape gives focus back to More.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); moreRef.current?.focus(); } };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !moreRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  const go = (key: Screen) => { setScreen(key); setOpen(false); };
  const inMore = !FIXED.includes(screen);
  const itemClass = "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all";

  return (
    <div className="md:hidden relative flex-shrink-0">
      {open && (
        <div
          ref={panelRef}
          id={PANEL_ID}
          className="absolute bottom-full left-0 right-0 grid grid-cols-4 gap-1 p-2 shadow-2xl"
          style={{ background: T.panel, borderTop: `1px solid ${T.line}` }}
        >
          {NAV.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => go(key)}
              aria-current={screen === key ? "page" : undefined}
              className={itemClass}
              style={{ color: screen === key ? T.brass : T.mute }}
            >
              <span className="text-base leading-none">{icon}</span>
              <span className="text-[11px] font-medium text-center leading-tight">{label}</span>
            </button>
          ))}
        </div>
      )}
      <nav className="flex items-center justify-around px-1 py-2" style={{ background: T.panel, borderTop: `1px solid ${T.line}` }}>
        {FIXED.map((key) => {
          const { label, icon } = NAV.find((n) => n.key === key)!;
          const active = screen === key;
          return (
            <button key={key} onClick={() => go(key)} aria-current={active ? "page" : undefined} className={itemClass} style={{ color: active ? T.brass : T.mute }}>
              <span className="text-base leading-none">{icon}</span>
              <span className="text-[11px] font-medium whitespace-nowrap">{label}</span>
            </button>
          );
        })}
        <button
          ref={moreRef}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={PANEL_ID}
          aria-current={inMore ? "page" : undefined}
          className={itemClass}
          style={{ color: inMore || open ? T.brass : T.mute }}
        >
          <span className="text-base leading-none">⋯</span>
          <span className="text-[11px] font-medium whitespace-nowrap">More</span>
        </button>
      </nav>
    </div>
  );
}
