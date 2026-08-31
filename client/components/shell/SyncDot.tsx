import type { SyncStatus } from "../screens/shared";
import type { useTheme } from "../../contexts/ThemeContext";

type Theme = ReturnType<typeof useTheme>;

/**
 * Shared sync-status color/label mapping -- was duplicated independently in
 * TopBar.tsx (mobile) and Sidebar.tsx (desktop), each its own ternary chain,
 * plus a third, never-rendered copy that used to live as a component in this
 * file (2026-08-29 usability-backlog audit, 2.4.49-adjacent finding: found
 * while investigating a reported "sync conflict is invisible on touch"
 * complaint that turned out not to be true live -- both real consumers
 * already show full text, TopBar via its tap-menu, Sidebar inline when
 * expanded -- but the duplicated mapping itself was real and worth fixing).
 */
export function syncStatusColor(status: Exclude<SyncStatus, "idle">, T: Theme): string {
  return status === "synced" ? T.jade : status === "syncing" ? T.brass : status === "conflict" ? T.coral : T.mute;
}

/** Short form, for space-constrained inline display (Sidebar's under-name label). */
export function syncStatusShortLabel(status: Exclude<SyncStatus, "idle">): string {
  return status === "syncing" ? "Syncing…" : status === "synced" ? "Synced" : status === "conflict" ? "Sync conflict" : "Offline";
}

/** Long form, for a dedicated status line (TopBar's account-menu paragraph). */
export function syncStatusLongLabel(status: Exclude<SyncStatus, "idle">): string {
  return status === "syncing" ? "Syncing…"
    : status === "synced" ? "Synced"
    : status === "conflict" ? "Sync conflict — server has newer data. Resolve in Settings."
    : "Sync offline — changes saved on this device only";
}
