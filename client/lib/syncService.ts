"use client";

import type { LocalFinancials } from "./localData";
import { getSyncToken } from "./crypto";
import { getRecoveryTokenForSync } from "./auth";

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
  const token = getSyncToken();
  if (!token) return { ok: false, error: "Not signed in — sign in again to sync." };
  // Registers this account's recovery-derived token server-side (if one
  // exists locally) so a future password reset can relink sync via
  // relinkSync below instead of hitting the old "server rejects every push
  // after a reset" limitation.
  const recoveryToken = getRecoveryTokenForSync(email);
  try {
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, data, token, ...(recoveryToken ? { recoveryToken } : {}) }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error ?? "Sync failed." };
    localStorage.setItem(LAST_SYNC_KEY, json.syncedAt);
    return { ok: true, syncedAt: json.syncedAt };
  } catch {
    return { ok: false, error: "Could not reach server. Is it running?" };
  }
}

/**
 * Re-registers sync ownership after a password reset, proving it via the
 * *previous* recovery token instead of the (now-changed) sync token — see
 * server/src/routes/sync.ts's /relink. Called fire-and-forget from
 * auth.ts's recoverAccount; a failure here just leaves the pre-existing
 * "push rejected until manually cleared" limitation in place, not a new
 * regression.
 */
export async function relinkSync(
  email: string, token: string, recoveryToken: string, oldRecoveryToken?: string,
): Promise<SyncResult> {
  try {
    const res = await fetch("/api/sync/relink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token, recoveryToken, ...(oldRecoveryToken ? { oldRecoveryToken } : {}) }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error ?? "Relink failed." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach server." };
  }
}

export async function pullFromServer(email: string): Promise<{ ok: true; data: LocalFinancials; syncedAt: string } | { ok: false; error: string }> {
  const token = getSyncToken();
  if (!token) return { ok: false, error: "Not signed in — sign in again to sync." };
  try {
    const res = await fetch(`/api/sync/pull?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`);
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
