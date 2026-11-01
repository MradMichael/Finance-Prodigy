"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "../contexts/ThemeContext";

/**
 * Owner, session 34 (decision 26; the sentence and "Reload" approved). The service worker keeps the installed
 * build until this page asks for the new one, so a page never mixes two builds. When a new build's worker is
 * waiting and this page is controlled by the old one, this says so; Reload asks the waiting worker to take over
 * (SKIP_WAITING) and reloads once it has. A first install has no controller yet: nothing is shown, and its
 * worker taking control doesn't reload the page. Coming back into view asks the browser to check for a new build.
 */
export default function UpdateNotice() {
  const T = useTheme();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloadAsked = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let live = true;
    let reg: ServiceWorkerRegistration | null = null;
    const offer = (r: ServiceWorkerRegistration) => { if (live && r.waiting && sw.controller) setWaiting(r.waiting); };
    const onUpdateFound = () => {
      const incoming = reg?.installing;
      incoming?.addEventListener("statechange", () => { if (incoming.state === "installed" && reg) offer(reg); });
    };
    sw.ready.then((r) => {
      if (!live) return;
      reg = r;
      offer(r);
      r.addEventListener("updatefound", onUpdateFound);
    }).catch(() => {});
    const onVisible = () => { if (document.visibilityState === "visible") reg?.update().catch(() => {}); };
    const onControllerChange = () => { if (reloadAsked.current) window.location.reload(); };
    document.addEventListener("visibilitychange", onVisible);
    sw.addEventListener("controllerchange", onControllerChange);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
      sw.removeEventListener("controllerchange", onControllerChange);
      reg?.removeEventListener?.("updatefound", onUpdateFound);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 bottom-[4.75rem] md:bottom-4 z-50 w-[calc(100%-2rem)] max-w-md rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg"
      style={{ background: T.panel, border: `1px solid ${T.brass}60` }}
    >
      <p className="text-sm flex-1" style={{ color: T.text }}>A new version of ESSA is ready. Reload to use it.</p>
      <button
        onClick={() => { reloadAsked.current = true; waiting.postMessage({ type: "SKIP_WAITING" }); }}
        className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0 hover:opacity-90"
        style={{ background: T.jade, color: T.ink }}
      >
        Reload
      </button>
    </div>
  );
}
