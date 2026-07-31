"use client";

import { useState } from "react";
import type { Session } from "../../lib/auth";
import { useTheme } from "../../contexts/ThemeContext";
import { Signet } from "../EssaBrand";

export default function TopBar({ session, onProfile, onSignOut }: { session: Session; onProfile: () => void; onSignOut: () => void }) {
  const T        = useTheme();
  const [menu, setMenu] = useState(false);
  const initials = session.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <header
      className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 md:hidden"
      style={{ background: T.panel, borderBottom: `1px solid ${T.line}` }}
    >
      <div className="flex items-center gap-2">
        <Signet size={26} />
        <span className="text-sm font-semibold" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>ESSA</span>
      </div>
      <div className="relative" onKeyDown={(e) => { if (e.key === "Escape") setMenu(false); }}>
        <button
          onClick={() => setMenu((v) => !v)}
          aria-haspopup="true"
          aria-expanded={menu}
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-xl px-2.5 py-1.5"
          style={{ background: T.panelSoft }}
        >
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{ background: T.jade + "2A", color: T.jade }}>{initials}</div>
          <span className="text-[10px]" style={{ color: T.mute }}>▾</span>
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl py-2 z-20 shadow-2xl"
              style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <button onClick={() => { setMenu(false); onProfile(); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:opacity-80 flex gap-2" style={{ color: T.text }}>
                <span>⚙</span> Settings
              </button>
              <button onClick={() => { setMenu(false); onSignOut(); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:opacity-80 flex gap-2" style={{ color: T.coral }}>
                <span>→</span> Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
