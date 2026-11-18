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

      {/* Nav. F4 (session 56, held): it scrolls (min-h-0 lets it shrink in the column), so on a short window
          the last screens stay reachable instead of sitting under the account footer. */}
      <nav className="flex-1 min-h-0 py-3 space-y-0.5 px-2 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin]">
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
          // Session 53 (owner): collapsed, the button shows only the initials, so its name starts with them
          // (WCAG 2.5.3). Session 54 (owner): expanded, it shows the initials and the name, and its name holds
          // both, in that order. With no initials, the name form.
          aria-label={initials ? (expanded ? `${initials}, ${session.name}: account settings` : `${initials}, account settings`) : `${session.name}: account settings`}
          data-sync-status={syncStatus}
          className={`w-full flex items-center gap-2.5 px-2.5 rounded-xl transition-all hover:opacity-80 ${expanded ? "pt-2.5 pb-1" : "py-2.5"}`}
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
          {/* A word break between the initials and the name: the name check reads the button's visible words,
              and without it "QN" and "Quartz" run together. A space between flex items isn't drawn. */}
          {expanded && " "}
          {expanded && (
            <div className="text-left overflow-hidden flex-1">
              <p className="text-xs font-medium truncate" style={{ color: T.text }}>{session.name}</p>
            </div>
          )}
        </button>
        {/* Session 54 (owner): the email, or the sync status while syncing, sits under the button, lined up with
            the name, instead of inside it: inside, the name check (WCAG 2.5.3) needs every visible word in the
            button's name. It isn't part of the tap area. */}
        {expanded && (
          <p className="text-[10px] truncate pl-12 pr-2.5 pb-1.5" style={{ color: T.mute }}>
            {syncStatus !== "idle" ? syncStatusShortLabel(syncStatus) : session.email}
          </p>
        )}
      </div>
    </aside>
  );
}
