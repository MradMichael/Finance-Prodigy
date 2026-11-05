"use client";

import { useSyncExternalStore } from "react";

/**
 * PWA P3 (owner-approved, 2026-11-05): whether the browser says it is online (navigator.onLine), kept current by
 * its "online"/"offline" events. True can't prove a server is reachable -- the same rule as page.tsx's
 * failedSyncStatus -- so use it only to say "you're offline" when the device says so. The server render (no
 * navigator) reads as online, so nothing offline-only is in the prerendered page.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine !== false, () => true);
}
