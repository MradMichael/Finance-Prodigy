"use client";

import type { LocalFinancials } from "./localData";

// Relative paths — proxied to the real API server by the next.config.js
// rewrite (server-side), so this works unchanged whether the client and
// API are both local or deployed to separate origins (e.g. Vercel + Railway).
const LAST_SYNC_KEY = "essa_last_sync";

export interface SyncResult {
  ok: boolean;
  syncedAt?: string;
  error?: string;
}

export async function pushToServer(email: string, data: LocalFinancials): Promise<SyncResult> {
  try {
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, data }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error ?? "Sync failed." };
    localStorage.setItem(LAST_SYNC_KEY, json.syncedAt);
    return { ok: true, syncedAt: json.syncedAt };
  } catch {
    return { ok: false, error: "Could not reach server. Is it running?" };
  }
}

export async function pullFromServer(email: string): Promise<{ ok: true; data: LocalFinancials; syncedAt: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/sync/pull?email=${encodeURIComponent(email)}`);
    if (res.status === 404) return { ok: false, error: "No data on server yet — push first." };
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error ?? "Pull failed." };
    localStorage.setItem(LAST_SYNC_KEY, json.syncedAt);
    return { ok: true, data: json.data, syncedAt: json.syncedAt };
  } catch {
    return { ok: false, error: "Could not reach server. Is it running?" };
  }
}

export function getLastSyncTime(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LAST_SYNC_KEY);
}
