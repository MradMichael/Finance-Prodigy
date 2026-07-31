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

// A non-2xx response isn't guaranteed to have a JSON body — a proxy/platform
// timeout or crash page can return plain HTML. Letting res.json() throw
// there falls into the same catch block as a genuine network failure below,
// misreporting "server unreachable" when it actually responded, just not
// with JSON. Parsing separately keeps those two failure modes distinct.
async function parseJsonSafe(res: Response): Promise<{ error?: string; [key: string]: unknown } | null> {
  try { return await res.json(); } catch { return null; }
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
    const json = await parseJsonSafe(res);
    if (!res.ok) return { ok: false, error: json?.error ?? `Sync failed (HTTP ${res.status}).` };
    localStorage.setItem(LAST_SYNC_KEY, json!.syncedAt as string);
    return { ok: true, syncedAt: json!.syncedAt as string };
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
    const json = await parseJsonSafe(res);
    if (!res.ok) return { ok: false, error: json?.error ?? `Relink failed (HTTP ${res.status}).` };
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
    const json = await parseJsonSafe(res);
    if (!res.ok) return { ok: false, error: json?.error ?? `Pull failed (HTTP ${res.status}).` };
    localStorage.setItem(LAST_SYNC_KEY, json!.syncedAt as string);
    return { ok: true, data: json!.data as LocalFinancials, syncedAt: json!.syncedAt as string };
  } catch {
    return { ok: false, error: "Could not reach server. Is it running?" };
  }
}

export function getLastSyncTime(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LAST_SYNC_KEY);
}

/**
 * Removes this account's synced backup (and everything derived from it in
 * the analytics warehouse) from the server. Called fire-and-forget from
 * auth.ts's deleteAccount — local deletion is immediate either way; this is
 * best-effort cleanup so a deleted account doesn't leave a backup behind
 * indefinitely (see the Privacy Policy's known-gap note).
 */
export async function deleteFromServer(email: string, token: string): Promise<SyncResult> {
  try {
    const res = await fetch("/api/sync", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token }),
    });
    const json = await parseJsonSafe(res);
    if (!res.ok) return { ok: false, error: json?.error ?? `Delete failed (HTTP ${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach server." };
  }
}

/**
 * Checks whether this email already has synced data from some other
 * device — the only cross-device signal the server can give, since sign-up
 * itself never touches it (see routes/auth.ts). Best-effort UX warning,
 * not a hard block: returns false on any network failure so an offline or
 * server-down moment never prevents signing up.
 */
export async function checkEmailExists(email: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(email)}`);
    if (!res.ok) return false;
    const json = await res.json();
    return json.exists === true;
  } catch {
    return false;
  }
}
