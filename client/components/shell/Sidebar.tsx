"use client";

import { useState } from "react";
import type { Session } from "../../lib/auth";
import { useTheme } from "../../contexts/ThemeContext";
import { Signet } from "../EssaBrand";
import { NAV, type Screen, type SyncStatus } from "../screens/shared";

const SIDEBAR_PIN_KEY = "essa_sidebar_pinned";

export default function Sidebar({
  screen, setScreen, session, onProfile, syncStatus,
}: {
  screen: Screen; setScreen: (s: Screen) => void;
  session: Session; onProfile: () => void;
  syncStatus: SyncStatus;
}) {
  const T = useTheme();
  const initials = session.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_PIN_KEY) === "1";
  });
  const [hovered, setHovered] = useState(false);

  const expanded = pinned || hovered;

  function togglePin(e: React.MouseEvent) {
    e.stopPropagation();
    setPinned((v) => {
      const next = !v;
      localStorage.setItem(SIDEBAR_PIN_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <aside
      className="hidden md:flex flex-col flex-shrink-0"
      style={{
        width: expanded ? 220 : 60,
        transition: "width 0.18s ease",
        background: T.panel,
        borderRight: `1px solid ${T.line}`,
        overflow: "hidden",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Logo + pin button */}
      <div
        className="flex items-center gap-2 px-3.5 flex-shrink-0"
        style={{ height: 56, borderBottom: `1px solid ${T.line}` }}
      >
        <div className="flex-shrink-0"><Signet size={26} /></div>
        {expanded && (
          <>
            <span className="text-sm font-semibold flex-1 whitespace-nowrap" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
              ESSA
            </span>
            <button
              onClick={togglePin}
              title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg transition-all hover:opacity-80"
              style={{
                color: pinned ? T.brass : T.mute,
                background: pinned ? T.brass + "18" : "transparent",
                border: `1px solid ${pinned ? T.brass + "40" : "transparent"}`,
                fontSize: 12,
              }}
            >
              {pinned ? "◈" : "◇"}
            </button>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-hidden">
        {NAV.map(({ key, label, icon }) => {
          const active = screen === key;
          return (
            <button
              key={key}
              onClick={() => setScreen(key)}
              className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                background: active ? T.brass + "1A" : "transparent",
                color: active ? T.brass : T.mute,
                whiteSpace: "nowrap",
              }}
            >
              <span className="text-base w-5 text-center flex-shrink-0">{icon}</span>
              {expanded && <span>{label}</span>}
            </button>
          );
        })}
      </nav>

      {/* User + sync indicator */}
      <div className="flex-shrink-0 px-2 py-3" style={{ borderTop: `1px solid ${T.line}` }}>
        <button
          onClick={onProfile}
          className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl transition-all hover:opacity-80"
          style={{ whiteSpace: "nowrap" }}
        >
          <div className="relative flex-shrink-0">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
              style={{ background: T.jade + "2A", color: T.jade }}
            >
              {initials}
            </div>
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
          {expanded && (
            <div className="text-left overflow-hidden flex-1">
              <p className="text-xs font-medium truncate" style={{ color: T.text }}>{session.name}</p>
              <p className="text-[10px] truncate" style={{ color: T.mute }}>
                {syncStatus === "syncing" ? "Syncing…" : syncStatus === "synced" ? "Synced" : syncStatus === "offline" ? "Offline" : session.email}
              </p>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
