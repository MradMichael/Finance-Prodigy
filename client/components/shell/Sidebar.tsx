"use client";

import { useRef, useState } from "react";
import type { Session } from "../../lib/auth";
import { useTheme } from "../../contexts/ThemeContext";
import { Signet } from "../EssaBrand";
import { NAV, type Screen, type SyncStatus } from "../screens/shared";
import { syncStatusColor, syncStatusShortLabel } from "./SyncDot";

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
  const asideRef = useRef<HTMLElement>(null);

  const expanded = pinned || hovered;

  // Root cause of a real nav bug (2026-09): every nav button's onBlur called
  // setHovered(false) unconditionally, collapsing the whole sidebar the
  // instant ANY button lost focus -- including when focus was just moving to
  // a SIBLING button inside this same sidebar (e.g. clicking one nav item
  // right after another, which blurs the old one before focusing the new
  // one). That mid-click collapse shrinks the button widths, and if the
  // click's mouseup lands at a coordinate the now-collapsed button no longer
  // covers, the browser never synthesizes a `click` at all -- the button's
  // onClick silently never fires. `relatedTarget` on blur/focusout is the
  // element ABOUT to receive focus; only collapse when it's truly outside
  // this sidebar, not when it's another button within it.
  function handleBlurWithinSidebar(e: React.FocusEvent) {
    if (!asideRef.current?.contains(e.relatedTarget as Node | null)) {
      setHovered(false);
    }
  }

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
      ref={asideRef}
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
              aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"}
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
              onFocus={() => setHovered(true)}
              onBlur={handleBlurWithinSidebar}
              aria-label={label}
              aria-current={active ? "page" : undefined}
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
          onFocus={() => setHovered(true)}
          onBlur={handleBlurWithinSidebar}
          aria-label={`${session.name}: account settings`}
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
                style={{ background: syncStatusColor(syncStatus, T), borderColor: T.panel }}
              />
            )}
          </div>
          {expanded && (
            <div className="text-left overflow-hidden flex-1">
              <p className="text-xs font-medium truncate" style={{ color: T.text }}>{session.name}</p>
              <p className="text-[10px] truncate" style={{ color: T.mute }}>
                {syncStatus !== "idle" ? syncStatusShortLabel(syncStatus) : session.email}
              </p>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
