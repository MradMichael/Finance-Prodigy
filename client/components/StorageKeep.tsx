"use client";

import { useEffect, useState } from "react";
import { useTheme } from "../contexts/ThemeContext";

// PWA P3, owner-approved wording (2026-11-05). Each line reports the browser's own answer.
export const STORAGE_HEADING = "Storage on this device";
export const STORAGE_KEPT = "Your browser has agreed to keep ESSA's data on this device even when space runs low. Clearing site data or uninstalling still removes it.";
export const STORAGE_NOT_YET = "This browser may clear ESSA's data from this device if it runs low on space. Keeping backup on, or downloading your data, is what protects it.";
export const STORAGE_DECLINED = "This browser said no. It may still clear ESSA's data if it runs low on space. Keeping backup on, or downloading your data, is what protects it.";
export const STORAGE_UNSUPPORTED = "This browser doesn't say whether it keeps ESSA's data. Keeping backup on, or downloading your data, is what protects it.";
export const STORAGE_ASK = "Ask this browser to keep it";

type State = "checking" | "kept" | "notYet" | "asking" | "declined" | "unsupported";

/**
 * PWA P3 (owner-approved, 2026-11-05): what this browser says about keeping ESSA's data when space runs low
 * (navigator.storage.persisted()), and a button that asks it to (persist()). Never asked on its own: Firefox
 * answers persist() with a permission prompt, and the owner ruled out popups. What it can't undo: a "yes" stays
 * with the browser; only clearing site data takes it back.
 */
export default function StorageKeep() {
  const T = useTheme();
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let live = true;
    const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!s || typeof s.persisted !== "function" || typeof s.persist !== "function") { setState("unsupported"); return; }
    s.persisted().then((kept) => { if (live) setState(kept ? "kept" : "notYet"); }, () => { if (live) setState("unsupported"); });
    return () => { live = false; };
  }, []);

  async function ask() {
    setState("asking");
    try {
      setState((await navigator.storage.persist()) ? "kept" : "declined");
    } catch {
      setState("unsupported");
    }
  }

  const line = state === "kept" ? STORAGE_KEPT
    : state === "notYet" || state === "asking" ? STORAGE_NOT_YET
    : state === "declined" ? STORAGE_DECLINED
    : state === "unsupported" ? STORAGE_UNSUPPORTED
    : "";

  return (
    <div className="space-y-2 pt-2" style={{ borderTop: `1px solid ${T.line}` }}>
      <h3 className="text-xs font-semibold" style={{ color: T.text }}>{STORAGE_HEADING}</h3>
      <p role="status" className="text-xs leading-relaxed" style={{ color: T.mute }}>{line}</p>
      {(state === "notYet" || state === "asking") && (
        <button
          onClick={ask}
          disabled={state === "asking"}
          className="px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: T.line, color: T.text }}
        >
          {STORAGE_ASK}
        </button>
      )}
    </div>
  );
}
