"use client";

import { useState, useRef } from "react";
import type { Session } from "../../lib/auth";
import { useTheme } from "../../contexts/ThemeContext";
import { Signet } from "../EssaBrand";
import type { SyncStatus } from "../screens/shared";

export default function TopBar({ session, onProfile, onSignOut, syncStatus }: { session: Session; onProfile: () => void; onSignOut: () => void; syncStatus: SyncStatus }) {
  const T        = useTheme();
  const [menu, setMenu] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initials = session.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  // Every dismissal path (Escape, outside click, choosing an item) should
  // return focus to the trigger — otherwise a keyboard user's focus drops
  // to <body> with no visual indication of where it went.
  function closeMenu() {
    setMenu(false);
    triggerRef.current?.focus();
  }

  return (
    <header
      className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 md:hidden"
      style={{ background: T.panel, borderBottom: `1px solid ${T.line}` }}
    >
      <div className="flex items-center gap-2">
        <Signet size={26} />
        <span className="text-sm font-semibold" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>ESSA</span>
      </div>
      <div className="relative" onKeyDown={(e) => { if (e.key === "Escape") closeMenu(); }}>
        <button
          ref={triggerRef}
          onClick={() => setMenu((v) => !v)}
          aria-haspopup="true"
          aria-expanded={menu}
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-xl px-2.5 py-1.5"
          style={{ background: T.panelSoft }}
        >
          <div className="relative flex-shrink-0">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: T.jade + "2A", color: T.jade }}>{initials}</div>
            {syncStatus !== "idle" && (
              <span
                className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border"
                style={{
                  background: syncStatus === "synced" ? T.jade : syncStatus === "syncing" ? T.brass : T.mute,
                  borderColor: T.panel,
                }}
              />
            )}
          </div>
          <span className="text-[10px]" style={{ color: T.mute }}>▾</span>
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={closeMenu} />
            <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl py-2 z-20 shadow-2xl"
              style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              {syncStatus !== "idle" && (
                <p className="px-4 pb-2 mb-1 text-[10px] flex items-center gap-1.5" style={{ color: T.mute, borderBottom: `1px solid ${T.line}` }}>
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: syncStatus === "synced" ? T.jade : syncStatus === "syncing" ? T.brass : T.mute }}
                  />
                  {syncStatus === "syncing" ? "Syncing…" : syncStatus === "synced" ? "Synced" : "Sync offline — changes saved on this device only"}
                </p>
              )}
              <button onClick={() => { closeMenu(); onProfile(); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:opacity-80 flex gap-2" style={{ color: T.text }}>
                <span>⚙</span> Settings
              </button>
              <button onClick={() => { closeMenu(); onSignOut(); }}
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
