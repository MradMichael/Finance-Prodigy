"use client";

import type { LocalFinancials, StoredTransaction } from "./localData";
import { mergeTransactions } from "./localData";
import { getSyncToken } from "./crypto";
import { getRecoveryTokenForSync } from "./auth";

// Relative paths — proxied to the real API server by the next.config.js
// rewrite (server-side), so this works unchanged whether the client and
// API are both local or deployed to separate origins (e.g. Vercel + Railway).
const LAST_SYNC_KEY = "essa_last_sync";
// Generous relative to the admin health check's 4s — a push can carry up to
// a ~2MB data blob, not just a bare ping, so it needs real headroom before
// being treated as hung rather than just slow.
const SYNC_TIMEOUT_MS = 15_000;

export interface SyncResult {
  ok: boolean;
  syncedAt?: string;
  error?: string;
  // Set true only for 2.4.38's specific "server has moved on since your
  // last sync" rejection -- distinct from a transient/offline failure so
  // callers (autoSync) can show something other than "offline" for a
  // failure that retrying won't fix.
  conflict?: boolean;
}

/**
 * Guards every pull-then-overwrite path (2.4.37): handlePull, signInFromSync,
 * recoverFromSync. Originally scoped to handlePull alone on the reasoning
 * that the other two only run when there's no local account for this email,
 * so there's nothing local to protect -- wrong: `essa_users_v1` can go
 * missing (a private window, a cleared browser, a session hiccup) while the
 * device still holds real data under an id that record no longer points to,
 * and the guard needs to fire on THAT condition, not on which function is
 * about to overwrite. Confirmed live: this exact gap let a routine
 * `signInFromSync` silently revert a real debt payment and ~12 transactions
 * (2.4.33).
 *
 * Two sub-checks because the condition doesn't map onto every call site the
 * same way -- see hasRealLocalData/hasAnyLocalData's own comments.
 */
export async function confirmOverwriteIfNeeded(userId: string | undefined, sourceLabel: string): Promise<boolean> {
  const hasData = userId ? await hasRealLocalData(userId) : hasAnyLocalData();
  if (!hasData) return true; // nothing to lose -- proceed silently, no friction for the common new-device case
  return confirm(overwriteWarningMessage(sourceLabel));
}

/**
 * Coarse check for signInFromSync/recoverFromSync's no-known-local-userId
 * case -- there's no specific account id yet to run hasRealLocalData
 * against, since one hasn't been chosen/created. Does this browser hold
 * ANY account's local data at all, regardless of whose. Less precise than
 * hasRealLocalData (a legitimate multi-account device -- this app allows
 * several local accounts per browser, see auth.ts's isAdmin/listUsers --
 * occasionally gets an unnecessary prompt), but silent, irreversible data
 * loss is the worse failure mode, so a false-positive prompt is the correct
 * tradeoff here.
 */
export function hasAnyLocalData(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Object.keys(localStorage).some((k) => k.startsWith("essa_data_"));
  } catch {
    return false;
  }
}

/** Precise check for handlePull, and recoverFromSync's `existingId` branch: does this SPECIFIC local account currently hold real data a pull-driven overwrite would destroy. */
export async function hasRealLocalData(userId: string): Promise<boolean> {
  const { loadData, isEmptyFinancials } = await import("./localData");
  return !isEmptyFinancials(await loadData(userId));
}

function overwriteWarningMessage(sourceLabel: string): string {
  const last = getLastSyncTime();
  return `This will replace your local data with ${sourceLabel}${last ? ` (last synced ${new Date(last).toLocaleString("en-GB")})` : ""}. Anything changed on this device since then will be lost. Continue?`;
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
  if (!token) return { ok: false, error: "Not signed in. Sign in again to sync." };
  // Registers this account's recovery-derived token server-side (if one
  // exists locally) so a future password reset can relink sync via
  // relinkSync below instead of hitting the old "server rejects every push
  // after a reset" limitation.
  const recoveryToken = getRecoveryTokenForSync(email);
  // 2.4.38: the last syncedAt this device actually observed (from its own
  // last successful push or pull) -- lets the server tell "I'm still
  // building on what I last saw" apart from "something else has moved the
  // server on since." Absent for a client that's never synced at all yet,
  // or one running before this field existed -- the server treats a missing
  // value as unknown rather than rejecting, so an old/mid-upgrade client
  // isn't broken by a server that now expects it.
  const baseSyncedAt = getLastSyncTime();
  try {
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, data, token, ...(recoveryToken ? { recoveryToken } : {}), ...(baseSyncedAt ? { baseSyncedAt } : {}) }),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    const json = await parseJsonSafe(res);
    if (res.status === 409 && json?.code === "stale_push") {
      return { ok: false, conflict: true, error: json?.error ?? "Server data has changed since your last sync." };
    }
    if (!res.ok) return { ok: false, error: json?.error ?? `Sync failed (HTTP ${res.status}).` };
    // A 200 with no/malformed JSON body (proxy glitch, truncated response)
    // is a real but different failure from "couldn't reach the server at
    // all" — report it as such instead of falling through to json!.syncedAt
    // and throwing, which the outer catch would then relabel as offline.
    if (json === null || typeof json.syncedAt !== "string") {
      return { ok: false, error: "Server responded, but the response was malformed. Try again." };
    }
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
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    const json = await parseJsonSafe(res);
    if (!res.ok) return { ok: false, error: json?.error ?? `Relink failed (HTTP ${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach server." };
  }
}

export async function pullFromServer(email: string): Promise<{ ok: true; data: LocalFinancials; syncedAt: string; hasRecoveryCode: boolean } | { ok: false; error: string }> {
  const token = getSyncToken();
  if (!token) return { ok: false, error: "Not signed in. Sign in again to sync." };
  try {
    // Token travels as a header, not a query param — push/relink/delete
    // already send it in the POST body; a bearer secret in a URL is prone
    // to leaking via server access logs, browser history, and proxy/CDN
    // logs in ways a header isn't.
    const res = await fetch(`/api/sync/pull?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    const json = await parseJsonSafe(res);
    // 2.4.22: a bare 404 status alone isn't enough to conclude "no account
    // for this email" -- that's also what a platform-level 404 (routing
    // misconfiguration, proxy error page, unmigrated deploy) looks like from
    // here. Only trust it when the body actually carries the API's own
    // error-shaped response, matching what /pull's real 404 branch returns.
    if (res.status === 404 && json && typeof json.error === "string") {
      return { ok: false, error: "No data on server yet. Push first." };
    }
    if (!res.ok) return { ok: false, error: json?.error ?? `Pull failed (HTTP ${res.status}).` };
    if (json === null || typeof json.syncedAt !== "string" || !("data" in json)) {
      return { ok: false, error: "Server responded, but the response was malformed. Try again." };
    }
    localStorage.setItem(LAST_SYNC_KEY, json.syncedAt);
    return { ok: true, data: json.data as LocalFinancials, syncedAt: json.syncedAt, hasRecoveryCode: json.hasRecoveryCode === true };
  } catch {
    return { ok: false, error: "Could not reach server. Is it running?" };
  }
}

// 2.4.52, detection-only. Field -> the human-readable label used in the
// notice sentence, listed in the order they should appear if several
// diverge at once. Deliberately just these six -- the finding's own scope
// -- not the broader "settings" fields (income, lbpRate, budgetRule, etc.)
// that same finding also names; those are a separate, vaguer category with
// a real risk of noisy false positives (e.g. a rate the user is actively
// updating on two devices), left for whenever non-transaction data gets a
// real merge design, not this half-day detection pass.
const NON_TRANSACTION_ENTITY_FIELDS = [
  ["goals", "goals"],
  ["debts", "debts"],
  ["recurring", "recurring items"],
  ["assets", "other assets"],
  ["cards", "cards"],
  ["trackedBalances", "tracked balances"],
] as const satisfies readonly (readonly [keyof LocalFinancials, string])[];

// Order-independent structural equality -- a record rebuilt via `{...x,
// field: y}` can land with its keys in a different insertion order than
// the original even when every value is identical, which a plain
// JSON.stringify comparison would wrongly read as a real difference.
// Sorting object keys before stringifying makes the comparison depend only
// on content, not on how either side happened to construct the object.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/**
 * 2.4.52, detection-only -- mergeAndPush merges transactions (Phase 2.7);
 * every other entity array still silently resolves "local wins," with no
 * signal to the user that a real divergence happened. This function does
 * NOT change that resolution -- a genuine per-entity merge is real,
 * undesigned future work (see mergeAndPush's own doc comment) -- it only
 * notices when local's pre-merge copy of one of these arrays differs from
 * what was actually on the server, so a silent overwrite becomes a visible
 * one instead of never being found out. A coarse whole-array comparison,
 * not a per-record diff: detecting IS the entire scope of this pass.
 */
export function detectNonTransactionDivergence(local: LocalFinancials, server: LocalFinancials): string[] {
  const diverged: string[] = [];
  for (const [field, label] of NON_TRANSACTION_ENTITY_FIELDS) {
    const localVal = local[field] ?? [];
    const serverVal = server[field] ?? [];
    if (stableStringify(localVal) !== stableStringify(serverVal)) diverged.push(label);
  }
  return diverged;
}

export interface MergeConflictDetail {
  /** What the merge kept -- same object as mergeTransactions' own conflicts array. */
  winner: StoredTransaction;
  /** What got silently overridden -- the OTHER side's pre-merge copy. This is what a "was $X" trace needs and mergeTransactions' own conflicts array can't provide on its own (it only ever returns the winner). */
  loser: StoredTransaction;
}

export type MergeAndPushResult =
  | { ok: true; syncedAt: string; addedFromServer: number; conflictsResolved: number; conflicts: StoredTransaction[]; conflictDetails: MergeConflictDetail[]; nonTransactionDivergence: string[]; mergedData: LocalFinancials }
  | { ok: false; error: string; conflict?: boolean };

/**
 * Phase 2.7, sub-phase 2 -- wires mergeTransactions (sub-phase 1) into a
 * real pull-merge-push flow. Called on a stale_push conflict (2.4.38)
 * instead of only showing the static "resolve in Settings" indicator: pull
 * the server's current data, merge transactions with local's (both new-
 * elsewhere transactions survive, tombstones win, a genuine same-id
 * conflict resolves by updatedAt), push the merged result back.
 *
 * Non-transaction fields (goals/debts/recurring/assets/cards/
 * trackedBalances/settings) are NOT merged this phase -- design scope
 * (docs/ROADMAP.md Phase 2.7): those have no delete-tombstones today, so
 * naively unioning them by id risks resurrecting something one device
 * hard-deleted, the same class of bug 2.6.3(b) exists to prevent. They
 * keep today's pick-a-side resolution -- local's own values, since local
 * is the side initiating the merge -- with the transaction merge layered
 * on top.
 *
 * 2.4.52, detection-only (added after this sub-phase, its own separate
 * pass): a real divergence in those fields (e.g. a debt edited on one
 * device, a different edit to the same debt on the other) is now at least
 * DETECTED (nonTransactionDivergence, via detectNonTransactionDivergence)
 * -- it is still resolved as "local wins," exactly as before; detecting is
 * not resolving. A genuine non-transaction merge remains real, undesigned
 * future work, not implied by this function's name.
 *
 * No server-side change: the server stores one opaque blob with zero
 * merge awareness (confirmed by reading server/src/routes/sync.ts), so
 * this pull/merge/push sequence is the entire mechanism, client-side only.
 */
export async function mergeAndPush(email: string, local: LocalFinancials): Promise<MergeAndPushResult> {
  const pulled = await pullFromServer(email);
  if (!pulled.ok) return { ok: false, error: pulled.error };

  const merged = mergeTransactions(local.transactions, pulled.data.transactions);
  const mergedData: LocalFinancials = { ...local, transactions: merged.transactions };
  // Detected against local's PRE-merge copy vs. the server's copy -- what
  // actually diverged between the two devices, not the merged result
  // (which always equals local's own copy for these fields regardless).
  const nonTransactionDivergence = detectNonTransactionDivergence(local, pulled.data);

  const pushed = await pushToServer(email, mergedData);
  if (!pushed.ok) return { ok: false, error: pushed.error ?? "Merge succeeded locally, but push failed.", conflict: pushed.conflict };

  // Each conflict's winner is verbatim either local's or server's pre-merge
  // copy (resolveTransactionConflict never synthesizes a third value) --
  // whichever one it ISN'T is the loser, the value that got silently
  // overridden. Needed so the eventual notice can say "was $X", not just
  // "something changed" (owner's instruction, 2026-09-01).
  const conflictDetails: MergeConflictDetail[] = merged.conflicts.map((winner) => {
    const localOriginal = local.transactions.find((t) => t.id === winner.id)!;
    const serverOriginal = pulled.data.transactions.find((t) => t.id === winner.id)!;
    const loser = JSON.stringify(winner) === JSON.stringify(localOriginal) ? serverOriginal : localOriginal;
    return { winner, loser };
  });

  return {
    ok: true,
    syncedAt: pushed.syncedAt!,
    addedFromServer: merged.addedFromServer,
    conflictsResolved: merged.conflictsResolved,
    conflicts: merged.conflicts,
    conflictDetails,
    nonTransactionDivergence,
    mergedData,
  };
}

/**
 * Phase 2.7, sub-phase 3 -- the actual wording a user sees after an
 * automatic merge. Pure and separately testable so the wording rules
 * (owner's instruction, 2026-09-01) can be verified without a live sync:
 * 2 or fewer conflicts are named inline (what changed, what it was); 3 or
 * more collapse to a count plus a signal to review, rather than a wall of
 * text in a toast. Silence (empty string) only when there is truly
 * nothing to report -- a merge that added nothing and resolved nothing
 * (e.g. only non-transaction fields differed, which this phase doesn't
 * detect -- see 2.4.52) stays quiet, matching today's roughly-silent
 * successful-sync behavior.
 */
function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function buildMergeNoticeText(
  addedFromServer: number,
  conflictDetails: MergeConflictDetail[],
  // 2.4.52, detection-only -- labels from detectNonTransactionDivergence.
  // Appended as its own sentence, not folded into the transaction-conflict
  // wording above: it's a different kind of signal (a possible divergence
  // that was never inspected, not a resolved conflict with a known winner
  // and loser), and it must be able to appear even when addedFromServer is
  // 0 and conflictDetails is empty -- a debt-only edit conflict with zero
  // transaction activity is exactly the silent case this closes.
  nonTransactionDivergence: string[] = [],
): { text: string; showReviewLink: boolean } {
  const parts: string[] = [];
  if (addedFromServer > 0) {
    parts.push(`${addedFromServer} new transaction${addedFromServer === 1 ? "" : "s"} added`);
  }
  const n = conflictDetails.length;
  let showReviewLink = false;
  const describe = (d: MergeConflictDetail) =>
    `kept the newer edit to "${d.winner.description}" (${fmtMoney(d.winner.amount)}, was ${fmtMoney(d.loser.amount)})`;
  if (n === 1) {
    parts.push(describe(conflictDetails[0]));
  } else if (n === 2) {
    parts.push(conflictDetails.map(describe).join(" and "));
  } else if (n >= 3) {
    parts.push(`${n} edit conflicts resolved (kept the most recent edit each time)`);
    showReviewLink = true;
  }
  const mainText = parts.length > 0 ? `Merged with your other device — ${parts.join(", ")}.` : "";

  if (nonTransactionDivergence.length === 0) {
    return mainText ? { text: mainText, showReviewLink } : { text: "", showReviewLink: false };
  }
  const divergedSentence = `Your ${nonTransactionDivergence.join(", ")} may differ from your other device — this device's copy was kept automatically. Check Profile if something looks off.`;
  return { text: mainText ? `${mainText} ${divergedSentence}` : divergedSentence, showReviewLink };
}

export function getLastSyncTime(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LAST_SYNC_KEY);
}

const AUTO_PULL_KEY_PREFIX = "essa_auto_pull_done_";

/** Whether the one-time "pull on first load of an empty account" (see app/page.tsx) has already been attempted for this user on this device. Scoped per-userId, not global, so signing into a second account on the same browser still gets its own attempt. */
export function hasAutoPulled(userId: string): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(AUTO_PULL_KEY_PREFIX + userId) === "1";
}

export function markAutoPulled(userId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTO_PULL_KEY_PREFIX + userId, "1");
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
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
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
    const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(email)}`, { signal: AbortSignal.timeout(SYNC_TIMEOUT_MS) });
    if (!res.ok) return false;
    const json = await res.json();
    return json.exists === true;
  } catch {
    return false;
  }
}
