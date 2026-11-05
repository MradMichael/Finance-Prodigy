"use client";

import { useOnline } from "../lib/useOnline";
import { useTheme } from "../contexts/ThemeContext";

/** PWA P3, owner-approved wording (2026-11-05). A: backup will run by itself on reconnecting. */
export const OFFLINE_BACKS_UP = "You're offline. Changes are saved on this device and back up when you reconnect.";
/** B: every other case. Promises nothing beyond what is already true. */
export const OFFLINE_SAVED_HERE = "You're offline. Changes are saved on this device.";

/**
 * Whether sentence A is true: the automatic upload retries on reconnecting (page.tsx's "online" handler, and
 * the upload on next open; app/page.offline-edit-retry.test.tsx) only with backup on and nothing that stops
 * syncing -- refused credentials, a newer backup elsewhere, or a backup too large to upload.
 */
export function backupRetriesOnReconnect(s: { backupOn: boolean; syncRefused: boolean; newerBackup: boolean; backupTooLarge: boolean }): boolean {
  return s.backupOn && !s.syncRefused && !s.newerBackup && !s.backupTooLarge;
}

/**
 * PWA P3 (owner-approved, 2026-11-05): a strip under the top bar while the browser says it's offline. In the
 * page's flow, so it pushes the screen down instead of covering anything; gone once the browser is online.
 */
export default function OfflineNotice({ backsUp }: { backsUp: boolean }) {
  const T = useTheme();
  const online = useOnline();
  if (online) return null;
  return (
    <p
      role="status"
      className="px-4 md:px-10 py-2 text-xs flex-shrink-0"
      style={{ background: T.panelSoft, color: T.text, borderBottom: `1px solid ${T.line}` }}
    >
      {backsUp ? OFFLINE_BACKS_UP : OFFLINE_SAVED_HERE}
    </p>
  );
}
