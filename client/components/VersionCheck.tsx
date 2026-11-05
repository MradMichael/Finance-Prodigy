"use client";

import { useEffect, useState } from "react";
import { useTheme } from "../contexts/ThemeContext";

// PWA P5, owner-approved wording (2026-11-05).
export const VERSION_UNAVAILABLE = "Version not available in this browser.";
export const CHECK_FOR_UPDATES = "Check for updates";
export const CHECKING = "Checking…";
export const UP_TO_DATE = "You have the latest version.";
export const DOWNLOADING = "A new version is downloading. You'll see a Reload prompt when it's ready.";
export const READY = "A new version is ready. Use Reload at the bottom of the screen.";
export const CHECK_OFFLINE = "Couldn't check for updates: you're offline.";
export const CHECK_FAILED = "Couldn't check for updates. Try again in a minute.";

/** The commit (when the build had one) and the build ID's first 8 characters. */
export function versionLine({ build, commit }: { build: string; commit: string | null }): string {
  const b = build.slice(0, 8);
  return commit ? `Version ${commit} (build ${b})` : `Version: build ${b}`;
}

const WAIT_MS = 3000;
/** Read fresh each time: the connection can go while a check is in flight. */
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Asks the active worker which build it is (sw-template.js answers VERSION); null if it doesn't answer. */
function askVersion(reg: ServiceWorkerRegistration): Promise<{ build: string; commit: string | null } | null> {
  if (!reg.active || typeof MessageChannel === "undefined") return Promise.resolve(null);
  const channel = new MessageChannel();
  const answer = new Promise<{ build: string; commit: string | null } | null>((resolve) => {
    channel.port1.onmessage = (e) => {
      const d = e.data as { build?: unknown; commit?: unknown };
      resolve(typeof d?.build === "string" ? { build: d.build, commit: typeof d.commit === "string" ? d.commit : null } : null);
      channel.port1.close();
    };
  });
  reg.active.postMessage({ type: "VERSION" }, [channel.port2]);
  return within(answer, WAIT_MS);
}

/**
 * PWA P5 (owner-approved, 2026-11-05): which version this device runs, so it can be matched to the branch on
 * GitHub, and a check for a newer one. The check asks the browser to fetch /sw.js (served no-cache); "latest"
 * is said only when that fetch found nothing new. A new version found is announced by UpdateNotice, whose
 * Reload this points to.
 */
export default function VersionCheck() {
  const T = useTheme();
  const [line, setLine] = useState<string | null>(null);
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const sw = typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : undefined;
    if (!sw) { setLine(VERSION_UNAVAILABLE); return; }
    within(sw.ready, WAIT_MS).then(async (r) => {
      if (!live) return;
      if (!r) { setLine(VERSION_UNAVAILABLE); return; }
      setReg(r);
      const v = await askVersion(r);
      if (live) setLine(v ? versionLine(v) : VERSION_UNAVAILABLE);
    }, () => { if (live) setLine(VERSION_UNAVAILABLE); });
    return () => { live = false; };
  }, []);

  async function check() {
    if (!reg) return;
    if (isOffline()) { setResult(CHECK_OFFLINE); return; }
    setResult(CHECKING);
    try {
      await reg.update();
      setResult(reg.waiting ? READY : reg.installing ? DOWNLOADING : UP_TO_DATE);
    } catch {
      setResult(isOffline() ? CHECK_OFFLINE : CHECK_FAILED);
    }
  }

  return (
    <div className="px-4 py-3 rounded-xl space-y-2" style={{ background: T.panelSoft }}>
      <p className="text-sm" style={{ color: T.text }}>{line ?? ""}</p>
      {reg && (
        <button
          onClick={check}
          disabled={result === CHECKING}
          className="px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: T.line, color: T.text }}
        >
          {CHECK_FOR_UPDATES}
        </button>
      )}
      <p role="status" className="text-xs" style={{ color: T.mute }}>{result ?? ""}</p>
    </div>
  );
}
