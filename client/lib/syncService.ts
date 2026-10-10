"use client";

import type { LocalFinancials, StoredTransaction, SettingKey } from "./localData";
import { isEmptyFinancials, BUDGET_RULES } from "./localData";
import { mergeFinancials, stableStringify, MERGED_FIELDS, RULE_FIELDS, type MergeFinancialsResult, type MergeClash } from "./syncMerge";
import { cycleLabelLong, dayLabel } from "./period";
import { getSyncToken } from "./crypto";
import { getRecoveryTokenForSync, getSession } from "./auth";
import { loadSeen, saveSeen } from "./syncSeen";
import { CLOSED_EDIT_SENTENCE, type ClosedEdit } from "./closedEditNotice";
import { noticeMoney } from "./noticeMoney";

/** Plan H 5b: after a successful push the server holds what this device holds (see saveSeen). */
async function recordServerCopy(serverCopy: LocalFinancials): Promise<void> {
  const userId = getSession()?.userId;
  if (userId) await saveSeen(userId, serverCopy);
}
/** This device's record of the server's copy at its last sync, or null (the first merge after the update: today's merge). */
async function lastSeen() {
  const userId = getSession()?.userId;
  return userId ? loadSeen(userId) : null;
}

// Relative paths — proxied to the real API server by the next.config.js
// rewrite (server-side), so this works unchanged whether the client and
// API are both local or deployed to separate origins (e.g. Vercel + Railway).
// DI-16 (session 8): one sync time per account. It was one browser-wide
// value, so after one account synced, another's push carried that account's
// time as its base and could overwrite its own server copy without the
// conflict merge. Session 9 (owner): the old value goes to no account; an
// account with no time of its own sends FIRST_PUSH_BASE, so its first push
// always meets the conflict merge (when a server copy exists).
const LEGACY_LAST_SYNC_KEY = "essa_last_sync";
/** A base older than any server copy: the server refuses it whenever it holds one (409), so the push merges first. */
export const FIRST_PUSH_BASE = "1970-01-01T00:00:00.000Z";
const lastSyncKey = (userId: string) => `essa_last_sync_${userId}`;
/** The signed-in account, if the address being synced is its own; else null (nothing is recorded or read for it). */
function syncingUserId(email: string): string | null {
  const s = getSession();
  return s && s.email.toLowerCase() === email.toLowerCase().trim() ? s.userId : null;
}
/** Records the sync time for one account (sign-in and recovery call it once the account exists here). */
export function recordSyncTime(userId: string, syncedAt: string): void {
  localStorage.setItem(lastSyncKey(userId), syncedAt);
}
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
  // COPY-11's backstop: the user was asked before an empty account replaced a
  // backup that has data, and kept the backup. Not a failure, so no
  // "Offline" or "Couldn't reach backup".
  declined?: boolean;
  // Session 8 (held): the server took the push, but this device couldn't
  // record its time (storage). A success; the caller says storage is the
  // problem. Unrecorded, the next push meets a conflict and merges again,
  // finding nothing new.
  notRecorded?: boolean;
}

/** COPY-11, owner-approved wording (session 3): the ask before an empty account replaces a backup that has data. */
export const EMPTY_OVERWRITE_ASK = "Your backup on our server has data, but this device has none. Replace the backup with this empty copy? Cancel keeps the backup as it is.";
/** COPY-11, owner-approved wording (session 3): what Profile says when that ask was declined. */
export const EMPTY_PUSH_DECLINED = "Not uploaded: your backup on the server has data and this device has none, so the backup was kept.";

/**
 * COPY-11's backstop (owner, 2026-10-07): may an EMPTY account replace the
 * server copy? Reads the copy without recording a sync; asks only when it
 * has data. No copy, an empty one, or a read that fails (the push would
 * fail the same way) is no reason to ask.
 */
async function emptyOverwriteAllowed(email: string): Promise<boolean> {
  const pulled = await pullFromServer(email, { record: false });
  if (!pulled.ok || isEmptyFinancials(pulled.data)) return true;
  return confirm(EMPTY_OVERWRITE_ASK);
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

export async function pushToServer(
  email: string, data: LocalFinancials,
  // "Reset all data" passes allowEmptyOverwrite: its own typed confirm already says the backup is replaced.
  // DI-15: the conflict merge passes `record: false` (the caller records once
  // it has stored the merged copy: recordMergeStored) and the sync time of the
  // copy it pulled as `baseSyncedAt`.
  { allowEmptyOverwrite = false, record = true, baseSyncedAt: base }: { allowEmptyOverwrite?: boolean; record?: boolean; baseSyncedAt?: string } = {},
): Promise<SyncResult> {
  const token = getSyncToken();
  if (!token) return { ok: false, error: "Not signed in. Sign in again to sync." };
  if (!allowEmptyOverwrite && isEmptyFinancials(data) && !(await emptyOverwriteAllowed(email))) {
    return { ok: false, declined: true, error: EMPTY_PUSH_DECLINED };
  }
  // Registers this account's recovery-derived token server-side (if one
  // exists locally) so a future password reset can relink sync via
  // relinkSync below instead of hitting the old "server rejects every push
  // after a reset" limitation.
  const recoveryToken = await getRecoveryTokenForSync(email);
  // 2.4.38: the last syncedAt this device actually observed (from its own
  // last successful push or pull) -- lets the server tell "I'm still
  // building on what I last saw" apart from "something else has moved the
  // server on since." Absent for a client that's never synced at all yet,
  // or one running before this field existed -- the server treats a missing
  // value as unknown rather than rejecting, so an old/mid-upgrade client
  // isn't broken by a server that now expects it.
  // DI-16: this account's own time; with none yet (session 9, owner), a base
  // older than any server copy, so the first push merges rather than lands.
  const syncing = syncingUserId(email);
  const baseSyncedAt = base ?? getLastSyncTime(syncing) ?? (syncing ? FIRST_PUSH_BASE : undefined);
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
    if (record) {
      // Session 8 (held): outside the network's catch, which read a storage
      // throw here as "Could not reach server" for a push the server took.
      const id = syncingUserId(email);
      try {
        if (id) recordSyncTime(id, json.syncedAt);
      } catch {
        return { ok: true, syncedAt: json.syncedAt, notRecorded: true };
      }
      await recordServerCopy(data);
    }
    return { ok: true, syncedAt: json.syncedAt };
  } catch {
    return { ok: false, error: "Could not reach server. Is it running?" };
  }
}

export type BackupChoice = "on" | "off-delete" | "off-keep";

/**
 * Records the owner's backup choice and performs its ONE network
 * consequence (audit 2.4.153). The only place the choice is written, so the
 * Profile switch and the load-time prompt cannot disagree about what a
 * choice does.
 *
 *   on          -> uploads immediately, so the server copy carries the
 *                  choice and another device pulling it sees backup on
 *   off-keep    -> no network at all; the existing copy is deliberately
 *                  left standing and will go stale
 *   off-delete  -> deletes the server copy. Never pushes first.
 *
 * The returned data carries the choice whatever the network did: a server
 * that could not be reached does not turn backup back on, and a failed
 * upload does not turn it off. The caller saves it and shows `result`.
 * `decidedAt` is a UTC instant.
 */
export async function applyBackupChoice(
  email: string, data: LocalFinancials, choice: BackupChoice, now: Date = new Date(),
): Promise<{ data: LocalFinancials; result: SyncResult | null }> {
  const next: LocalFinancials = { ...data, syncChoice: { enabled: choice === "on", decidedAt: now.toISOString() } };
  if (choice === "on") return { data: next, result: await pushToServer(email, next) };
  if (choice === "off-delete") return { data: next, result: await deleteFromServer(email, getSyncToken() ?? "") };
  return { data: next, result: null };
}

export type ServerCopyProbe =
  | { kind: "copy"; hasRecoveryCode: boolean }
  | { kind: "none" }
  | { kind: "wrong-password" }
  | { kind: "unregistered" }
  | { kind: "unreachable" };

/**
 * What the server holds for this account, without changing anything
 * (FB-1b2). Regenerating a recovery code asks this before touching
 * anything, so it knows whether a server copy holds a code that must be
 * replaced through /relink.
 *
 * It's /pull with the bearer token, read for its status only. The body is
 * discarded, and unlike pullFromServer it doesn't record a last-sync time:
 * that time is 2.4.38's stale-push baseline, and only a pull whose data was
 * actually taken may move it.
 *
 *   copy           200: a copy exists and this device's password token is
 *                  the one it holds (sync.ts:255); hasRecoveryCode says
 *                  whether any recovery code is registered for it
 *   none           404 from the API itself: no copy at all
 *   wrong-password 401: a copy whose password token isn't this device's
 *   unregistered   401: a row with no password token at all (pre-token)
 *   unreachable    anything else, including a platform 404 page
 */
export async function probeServerCopy(email: string): Promise<ServerCopyProbe> {
  const token = getSyncToken();
  if (!token) return { kind: "unreachable" };
  try {
    const res = await fetch("/api/sync/pull", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    const json = await parseJsonSafe(res);
    const apiError = json !== null && typeof json.error === "string" ? json.error : null;
    if (res.status === 404 && apiError !== null) return { kind: "none" };
    if (res.status === 401 && apiError !== null) {
      return apiError.includes("no sync credentials registered") ? { kind: "unregistered" } : { kind: "wrong-password" };
    }
    if (res.ok && json !== null && typeof json.syncedAt === "string") return { kind: "copy", hasRecoveryCode: json.hasRecoveryCode === true };
    return { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
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

/**
 * `record: false` leaves the last-sync time alone (SYNC-1 step 3's fetch: see
 * fetchAndMerge). `timeoutMs` lets a background fetch wait out Render's
 * wake-up. `notFound` marks the API's own "no copy" answer, apart from a
 * failure.
 */
export async function pullFromServer(
  email: string,
  { record = true, timeoutMs = SYNC_TIMEOUT_MS }: { record?: boolean; timeoutMs?: number } = {},
): Promise<{ ok: true; data: LocalFinancials; syncedAt: string; hasRecoveryCode: boolean; notRecorded?: true } | { ok: false; error: string; notFound?: true }> {
  const token = getSyncToken();
  if (!token) return { ok: false, error: "Not signed in. Sign in again to sync." };
  try {
    // Token travels as a header, not a query param — push/relink/delete
    // already send it in the POST body; a bearer secret in a URL is prone
    // to leaking via server access logs, browser history, and proxy/CDN
    // logs in ways a header isn't. The address travels in the body for the
    // same reason (2.4.165): Vercel's rewrite logs record a URL's search
    // params and Render's request logs record the whole URL.
    const res = await fetch("/api/sync/pull", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await parseJsonSafe(res);
    // 2.4.22: a bare 404 status alone isn't enough to conclude "no account
    // for this email" -- that's also what a platform-level 404 (routing
    // misconfiguration, proxy error page, unmigrated deploy) looks like from
    // here. Only trust it when the body actually carries the API's own
    // error-shaped response, matching what /pull's real 404 branch returns.
    if (res.status === 404 && json && typeof json.error === "string") {
      return { ok: false, error: "No data on server yet. Push first.", notFound: true };
    }
    if (!res.ok) return { ok: false, error: json?.error ?? `Pull failed (HTTP ${res.status}).` };
    if (json === null || typeof json.syncedAt !== "string" || !("data" in json)) {
      return { ok: false, error: "Server responded, but the response was malformed. Try again." };
    }
    const pulled = { ok: true as const, data: json.data as LocalFinancials, syncedAt: json.syncedAt, hasRecoveryCode: json.hasRecoveryCode === true };
    if (record) {
      // Session 9 (owner): outside the network's catch, as the push's (session
      // 8): the server answered, so a storage throw here isn't "Could not
      // reach server", and the copy is still handed back.
      const id = syncingUserId(email);
      try {
        if (id) recordSyncTime(id, json.syncedAt);
      } catch {
        return { ...pulled, notRecorded: true as const };
      }
    }
    return pulled;
  } catch {
    return { ok: false, error: "Could not reach server. Is it running?" };
  }
}

// Plan H 5d (owner, session 6): 2.4.52's detection, kept for one case only:
// a device's first merge, before it has a record of a last sync. That merge
// keeps this device's copy of these fields, as it always did, and says so.
//
// 2.4.52, detection-only. Field -> the human-readable label used in the
// notice sentence, listed in the order they should appear if several
// diverge at once. Deliberately just these six -- the finding's own scope
// -- not the broader "settings" fields (income, lbpRate, budgetRule, etc.)
// that same finding also names; those are a separate, vaguer category with
// a real risk of noisy false positives (e.g. a rate the user is actively
// updating on two devices), left for whenever non-transaction data gets a
// real merge design, not this half-day detection pass.
//
// SYNC-1 step 2 (2026-10-06): tracked balances left this list, because they
// merge now (lib/syncMerge.ts), as do the wishlist, custom categories,
// category rules and period closes. The SETTINGS below joined it, by the
// owner's decision: they stay "this device wins", and the notice names them.
//
// Third column (owner, 2026-10-07): the screen the notice sends you to.
// Assets and cards are both on My Finances (Other Assets; the card picker
// under Log an entry).
const NON_TRANSACTION_ENTITY_FIELDS = [
  ["goals", "goals", "Goals"],
  ["debts", "debts", "Debts"],
  ["recurring", "recurring items", "Recurring"],
  ["assets", "assets", "My Finances"],
  ["cards", "cards", "My Finances"],
] as const satisfies readonly (readonly [keyof LocalFinancials, string, string])[];

/** Settings, as the screens resolve them: an unset budget rule is 50/30/20, and an unset payday is the 1st. */
const SETTINGS: readonly (readonly [string, (d: LocalFinancials) => unknown])[] = [
  ["income", (d) => d.income],
  ["LBP rate", (d) => d.lbpRate],
  ["budget split", (d) => {
    const rule = d.budgetRule ?? "50-30-20";
    return rule === "custom" ? { rule, needs: d.budgetCustomNeeds, wants: d.budgetCustomWants } : { rule };
  }],
  ["payday", (d) => d.cycleStartDay ?? 1],
  ["emergency fund target", (d) => d.emergencyFundTargetMonths],
];

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
  for (const [label, read] of SETTINGS) {
    if (stableStringify(read(local)) !== stableStringify(read(server))) diverged.push(label);
  }
  return diverged;
}
export interface MergeConflictDetail {
  /** What the merge kept -- same object as mergeTransactions' own conflicts array. */
  winner: StoredTransaction;
  /** What got silently overridden -- the OTHER side's pre-merge copy. This is what a "was $X" trace needs and mergeTransactions' own conflicts array can't provide on its own (it only ever returns the winner). */
  loser: StoredTransaction;
}

/** A close made on THIS device that lost to another device's earlier close of the same cycle (SYNC-1 step 2). */
export interface ReplacedCloseNotice { cycleLabel: string; standingClosedAt: string }

export type MergeAndPushResult =
  // mergedData is on the server, not yet on this device: store it, then recordMergeStored. If the store fails, record nothing.
  | { ok: true; syncedAt: string; addedFromServer: number; conflictsResolved: number; conflicts: StoredTransaction[]; conflictDetails: MergeConflictDetail[]; clashes: MergeClash[]; nonTransactionDivergence: string[]; replacedCloses: ReplacedCloseNotice[]; mergedData: LocalFinancials; firstSync: boolean; /** Item 7: the other device's edits inside a closed cycle. */ closedEdits: ClosedEdit[] }
  | { ok: false; error: string; conflict?: boolean };

/**
 * Phase 2.7, sub-phase 2 -- wires mergeTransactions (sub-phase 1) into a
 * real pull-merge-push flow. Called on a stale_push conflict (2.4.38)
 * instead of only showing the static "resolve in Settings" indicator: pull
 * the server's current data, merge transactions with local's (both new-
 * elsewhere transactions survive, tombstones win, a genuine same-id
 * conflict resolves by updatedAt), push the merged result back.
 *
 * Plan H (SYNC-1 step 4): with a record of this device's last sync, goals,
 * debts, recurring items, assets, cards, settings and the histories merge
 * too (lib/syncMerge.ts), and each change both devices made is returned as a
 * clash for the notice to name. Without a record (the first merge after the
 * update), they keep this device's copy, as before, and 2.4.52's "may
 * differ" detection says so: that first merge only (owner, session 6).
 *
 * No server-side change: the server stores one opaque blob with zero
 * merge awareness (confirmed by reading server/src/routes/sync.ts), so
 * this pull/merge/push sequence is the entire mechanism, client-side only.
 *
 * DI-15: **the sync is NOT recorded here**, neither the time nor the sync
 * record. This device doesn't hold the merged copy until the caller stores
 * it; then the caller calls recordMergeStored. If the store fails, nothing is
 * recorded and nothing is dropped (owner, session 8): the time and the record
 * still describe the copy this device holds, so its next push meets a
 * conflict, and the merge that follows takes the other device's changes.
 * Recorded at the push, a failed store left a device whose next merge read
 * the other device's changes as its own edits and reverted them, and whose
 * next push landed without a conflict and overwrote the merged copy.
 */
export async function mergeAndPush(email: string, local: LocalFinancials): Promise<MergeAndPushResult> {
  const seen = await lastSeen();
  const pulled = await pullFromServer(email, { record: false });
  if (!pulled.ok) return { ok: false, error: pulled.error };

  // SYNC-1 step 2: the whole merge, not transactions alone. The wishlist,
  // categories, rules, tracked balances and period closes merge too
  // (lib/syncMerge.ts); everything else keeps this device's copy, as before.
  const result = mergeFinancials(local, pulled.data, new Date(), seen);
  const merged = result.transactions;
  const mergedData: LocalFinancials = result.data;
  const { conflictDetails, replacedCloses } = describeMerge(result);

  // Built on the copy just pulled, so the server takes it; this device's own
  // sync time stays where it was until the merged copy is stored.
  const pushed = await pushToServer(email, mergedData, { record: false, baseSyncedAt: pulled.syncedAt });
  if (!pushed.ok) return { ok: false, error: pushed.error ?? "Merge succeeded locally, but push failed.", conflict: pushed.conflict };

  return {
    ok: true,
    syncedAt: pushed.syncedAt!,
    addedFromServer: merged.addedFromServer,
    conflictsResolved: merged.conflictsResolved,
    conflicts: merged.conflicts,
    conflictDetails,
    clashes: result.clashes,
    nonTransactionDivergence: seen ? [] : detectNonTransactionDivergence(local, pulled.data),
    replacedCloses,
    mergedData,
    firstSync: !seen,
    closedEdits: result.closedEdits,
  };
}

/**
 * Session 10 (DI-15 on pulls): a restore's copy is stored on this device, so
 * record its time. Restores pull with `record: false` and call this after
 * the store: recorded first, a store that failed left this device's old copy
 * on the server's newest time, and its next push overwrote the server's copy
 * without a conflict. False when storage refused the time: the copy is in
 * place, and the next push merges (FIRST_PUSH_BASE or the older time).
 */
export function recordRestoreStored(userId: string, syncedAt: string): boolean {
  try {
    recordSyncTime(userId, syncedAt);
    return true;
  } catch {
    return false;
  }
}

/**
 * DI-15: the conflict merge's copy is stored on this device, so record the
 * sync: its time (this device's next push builds on the merged copy) and the
 * sync record (plan H 5b: the server holds the merged copy, and so does this
 * device now).
 */
export async function recordMergeStored(userId: string, merged: { syncedAt: string; mergedData: LocalFinancials }): Promise<void> {
  try {
    recordSyncTime(userId, merged.syncedAt);
  } catch {
    // Unrecorded: the next push meets a conflict and merges again, finding nothing new.
  }
  await saveSeen(userId, merged.mergedData);
}

/** What a merge resolved, as the notice names it. Shared by the conflict merge and the fetch. */
function describeMerge(result: MergeFinancialsResult): { conflictDetails: MergeConflictDetail[]; replacedCloses: ReplacedCloseNotice[] } {
  // Each conflict's winner is verbatim either local's or server's pre-merge
  // copy (resolveTransactionConflict never synthesizes a third value) --
  // whichever one it ISN'T is the loser, the value that got silently
  // overridden. Needed so the eventual notice can say "was $X", not just
  // "something changed" (owner's instruction, 2026-09-01).
  // Each side as the merge saw it: after any close undo, which can soft-delete
  // a correction row on one side.
  const conflictDetails = result.transactions.conflicts.map((winner) => {
    const localOriginal = (result.localTransactions ?? []).find((t) => t.id === winner.id)!;
    const serverOriginal = (result.serverTransactions ?? []).find((t) => t.id === winner.id)!;
    const loser = JSON.stringify(winner) === JSON.stringify(localOriginal) ? serverOriginal : localOriginal;
    return { winner, loser };
  });
  const replacedCloses = result.supersededFromLocal.map((r) => ({
    cycleLabel: cycleLabelLong(r.standing.cycleKey, r.standing.startDayAtClose),
    standingClosedAt: r.standing.closedAt,
  }));
  return { conflictDetails, replacedCloses };
}

/** A background fetch waits out Render's free-tier wake-up (30 s or more), unlike an upload's 15 s. */
const FETCH_TIMEOUT_MS = 45_000;

export type FetchAndMergeResult =
  | { ok: true; skipped: true }
  | {
      ok: true;
      skipped?: undefined;
      mergedData: LocalFinancials;
      /** The server's copy as fetched: record it (saveSeen) once mergedData is stored. */
      serverCopy: LocalFinancials;
      /** The merge brought something this device didn't have. */
      localChanged: boolean;
      /** The merged copy holds something the server lacks, in the fields that merge. */
      serverBehind: boolean;
      addedFromServer: number;
      conflictDetails: MergeConflictDetail[];
      /** Plan H: changes both devices made, settled by edit time. */
      clashes: MergeClash[];
      /** 2.4.52's labels, on a device's first merge only (no record of a last sync yet); else empty. */
      nonTransactionDivergence: string[];
      /** This device had no record of a last sync before this merge (session 7: its clash records are taken as shown). */
      firstSync: boolean;
      replacedCloses: ReplacedCloseNotice[];
      /** Item 7: the other device's edits inside a closed cycle. */
      closedEdits: ClosedEdit[];
    }
  | { ok: false; error: string; notFound?: true };

/** The same records, whatever order the two copies hold them in. */
function sameRecords(a: LocalFinancials, b: LocalFinancials, fields: readonly (keyof LocalFinancials)[] = MERGED_FIELDS): boolean {
  const canon = (d: LocalFinancials, k: keyof LocalFinancials) => {
    const v = d[k];
    return Array.isArray(v) ? v.map((x) => stableStringify(x)).sort() : stableStringify(v ?? {});
  };
  return fields.every((k) => stableStringify(canon(a, k)) === stableStringify(canon(b, k)));
}

/**
 * SYNC-1 step 3 (DI-10): fetch the server's copy and merge it into this
 * device's, for the dashboard to run when ESSA opens or comes back into view
 * with backup on. The caller applies the result; this reaches the network
 * once, for the pull, and never pushes.
 *
 * - **The sync time is NOT recorded.** The merge keeps this device's copy of
 *   goals, debts, recurring items, assets, cards and settings, so the
 *   server's data was not taken in full. Recorded, this device's next push
 *   would land without a conflict and silently overwrite the other device's
 *   edits to those fields, with no notice naming them. Unrecorded, that push
 *   meets mergeAndPush exactly as it does without this fetch.
 * - **The merge runs against `currentLocal()` read when the pull lands**, so
 *   an edit made while the server woke up is part of it. Null (signed out
 *   meanwhile) skips.
 * - **`serverBehind` counts only the fields that merge.** A difference in the
 *   others is not a reason to push: this device merely being opened would
 *   overwrite the other device's newer edits to them.
 */
export async function fetchAndMerge(email: string, currentLocal: () => LocalFinancials | null): Promise<FetchAndMergeResult> {
  const seen = await lastSeen();
  const pulled = await pullFromServer(email, { record: false, timeoutMs: FETCH_TIMEOUT_MS });
  if (!pulled.ok) return { ok: false, error: pulled.error, ...(pulled.notFound ? { notFound: true as const } : {}) };
  const local = currentLocal();
  if (!local) return { ok: true, skipped: true };
  const result = mergeFinancials(local, pulled.data, new Date(), seen);
  // Plan H 5b: under the rule, more fields merge, so more fields can differ.
  const fields = seen ? [...MERGED_FIELDS, ...RULE_FIELDS] : MERGED_FIELDS;
  return {
    ok: true,
    mergedData: result.data,
    serverCopy: pulled.data,
    localChanged: !sameRecords(result.data, local, fields),
    serverBehind: !sameRecords(result.data, pulled.data, fields),
    addedFromServer: result.transactions.addedFromServer,
    clashes: result.clashes,
    nonTransactionDivergence: seen ? [] : detectNonTransactionDivergence(local, pulled.data),
    firstSync: !seen,
    closedEdits: result.closedEdits,
    ...describeMerge(result),
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
export function buildMergeNoticeText(
  addedFromServer: number,
  conflictDetails: MergeConflictDetail[],
  // Plan H 5d: what both devices changed outside transactions (a goal, a
  // setting...), settled by edit time. One sentence each, after what
  // arrived; they count toward the three-or-more collapse. They replace
  // 2.4.52's "may differ" sentences (owner, session 5).
  clashes: MergeClash[] = [],
  // SYNC-1 step 2: a close made on this device that another device's
  // earlier close of the same cycle replaced. Told plainly, because the owner
  // made it and it was undone.
  replacedCloses: ReplacedCloseNotice[] = [],
  // 2.4.52's labels (detectNonTransactionDivergence), on a device's first
  // merge only, before it has a record of a last sync (owner, session 6).
  nonTransactionDivergence: string[] = [],
  // Item 7 (owner, session 8): the other device's one-sided edits inside a
  // closed cycle. DRAFT wording (lib/closedEditNotice.ts), held for approval.
  closedEdits: ClosedEdit[] = [],
): { text: string; showReviewLink: boolean } {
  const parts: string[] = [];
  if (addedFromServer > 0) {
    parts.push(`${addedFromServer} new transaction${addedFromServer === 1 ? "" : "s"} added`);
  }
  // "Kept the newer edit" only when one copy is newer (owner, 2026-10-07):
  // both carry an edit time and the kept one's is later, or only the kept one
  // carries one -- every write has stamped a time since 2.6.3(c), so the
  // unstamped copy's last edit came first (the merge sorts it as older too).
  // Anything else gets its own sentence after what arrived: a tie (the same
  // recorded time; the content tie-break decided) in the owner's tie wording,
  // and two copies with no time at all in the owner's "different versions"
  // wording (session 3), which claims neither a moment nor who changed it.
  const at = (t: StoredTransaction) => (t.updatedAt ? new Date(t.updatedAt).getTime() : null);
  const isNewer = (d: MergeConflictDetail) => {
    const w = at(d.winner), l = at(d.loser);
    return w !== null && (l === null || w > l);
  };
  const isTie = (d: MergeConflictDetail) => at(d.winner) !== null && at(d.winner) === at(d.loser);
  // DI-12 (owner, 2026-10-07): the notice never describes a deleted or
  // purged record. The merge no longer reports one as a conflict; this holds
  // the line for any caller.
  const gone = (t: StoredTransaction) => t.deletedAt != null || t.purgedAt != null;
  const described = conflictDetails.filter((d) => !gone(d.winner) && !gone(d.loser));
  // Item 7 (owner, session 8): a transaction both devices changed reaches the
  // overridden device as a clash record, named in the same sentences as this
  // merge's own conflicts. A record for a transaction this merge already
  // names (the merging device's own) isn't named twice.
  const txClashes = clashes.filter((c): c is Extract<MergeClash, { kind: "transaction" }> =>
    c.kind === "transaction" && !described.some((d) => d.winner.id === (c as { key?: string }).key));
  const otherClashes = clashes.filter((c): c is Exclude<MergeClash, { kind: "transaction" }> => c.kind !== "transaction");
  // Session 9 (owner): each amount in its own currency (noticeMoney).
  const named: { name: string; kept: string; other: string; how: "newer" | "tie" | "versions" }[] = [
    ...described.map((d) => ({ name: d.winner.description, kept: noticeMoney(d.winner.amount, d.winner.currency), other: noticeMoney(d.loser.amount, d.loser.currency), how: isNewer(d) ? "newer" as const : isTie(d) ? "tie" as const : "versions" as const })),
    ...txClashes.map((c) => ({ name: c.name, kept: noticeMoney(c.kept, c.keptCurrency), other: noticeMoney(c.other, c.otherCurrency), how: c.how })),
  ];
  // Three or more conflicts in all (owner, session 4): one line for them
  // all, with the review link, in place of every sentence below; one or two
  // keep their own. It retires 2026-09-01's "N edit conflicts resolved (kept
  // the most recent edit each time)".
  const collapsed = named.length + otherClashes.length >= 3;
  const edits = collapsed ? [] : named.filter((n) => n.how === "newer");
  const undated = collapsed ? [] : named.filter((n) => n.how !== "newer");
  // The review link opens the Transactions screen's conflict view, so only when a transaction is among them.
  const showReviewLink = collapsed && described.length > 0;
  const describe = (n: (typeof named)[number]) =>
    `kept the newer edit to "${n.name}" (${n.kept}, was ${n.other})`;
  if (edits.length) parts.push(edits.map(describe).join(" and "));
  const mainText = parts.length > 0 ? `Merged with your other device — ${parts.join(", ")}.` : "";
  const collapseLine = collapsed
    ? collapsedConflictLine([
        ...named.map((n) => ({ kind: "transaction", name: n.name })),
        ...otherClashes.map((c) => ({ kind: c.kind, name: c.kind === "setting" ? SETTING_NAMES[c.setting] : c.name })),
      ])
    : "";

  // Owner's wording (2026-10-06, -07). A sentence for the lists and one for
  // the settings, each naming only what differs, in their own order:
  //   lists:    "Your goals, debts, recurring items, assets or cards may
  //             differ from your other device — this device's copy was kept.
  //             Check Goals, Debts, Recurring and My Finances if something
  //             looks off." -- the screens of the lists that differ, each once;
  //   settings: "Your income and LBP rate may differ ... was kept.
  //             Check Setup, Budget and Currency if something looks off." --
  //             income, payday and the emergency fund target are on Setup,
  //             the budget split on Budget, the LBP rate on Currency.
  const differs = (label: string) => nonTransactionDivergence.includes(label);
  const lists = NON_TRANSACTION_ENTITY_FIELDS.filter(([, label]) => differs(label));
  const settings = SETTINGS.map(([label]) => label).filter(differs);
  const listScreens = [...new Set(lists.map(([, , screen]) => screen))];
  const sentences = [
    mainText,
    collapseLine,
    ...undated.map((n) => n.how === "tie"
      ? `Both devices changed "${n.name}" at the same moment — kept ${n.kept} (the other copy said ${n.other}).`
      : `Your devices had different versions of "${n.name}" — kept ${n.kept} (the other copy said ${n.other}).`),
    ...(collapsed ? [] : otherClashes.map(clashSentence)),
    // DRAFT (item 7, held): the other device's edits inside a closed cycle.
    ...closedEdits.map(CLOSED_EDIT_SENTENCE),
    lists.length
      ? `Your ${joinNames(lists.map(([, label]) => label), "or")} may differ from your other device — this device's copy was kept. Check ${joinNames(listScreens, "and")} if something looks off.`
      : "",
    settings.length
      ? `Your ${joinNames(settings, "and")} may differ from your other device — this device's copy was kept. Check Setup, Budget and Currency if something looks off.`
      : "",
    // DI-11 (owner's wording, 2026-10-07): the undone close's note is shown in
    // the account's Close history on Balance Check, so the notice says where.
    ...replacedCloses.map((r) =>
      `Two devices closed ${r.cycleLabel}. The earlier close, made on another device on ${closeMomentLabel(r.standingClosedAt)}, stands; this device's close was undone, and any note you wrote on it stays visible under Close history on Balance Check.`),
  ].filter(Boolean);
  return sentences.length ? { text: sentences.join(" "), showReviewLink } : { text: "", showReviewLink: false };
}

/**
 * Plan H 5d. Each setting by the name the owner approved for the retired
 * "may differ" sentence (2026-10-06, -07).
 */
const SETTING_NAMES: Record<SettingKey, string> = {
  income: "income", lbpRate: "LBP rate", budget: "budget split", payday: "payday", efTarget: "emergency fund target",
};
/** Each setting's value as the sentence shows it (owner-approved, session 6). */
function settingValueText(setting: SettingKey, v: unknown): string {
  switch (setting) {
    case "income": return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v));
    case "lbpRate": return `L£ ${Number(v).toLocaleString("en-US")} / $1`;
    case "payday": {
      const n = Number(v);
      const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
      return `the ${n}${suffix}`;
    }
    case "efTarget": return `${Number(v)} month${Number(v) === 1 ? "" : "s"}`;
    case "budget": {
      const b = v as { rule: string; needs?: number; wants?: number };
      if (b.rule !== "custom") return BUDGET_RULES[b.rule as keyof typeof BUDGET_RULES]?.label ?? b.rule;
      const needs = b.needs ?? 0, wants = b.wants ?? 0;
      return `${needs} / ${wants} / ${100 - needs - wants}`;
    }
  }
}
/** Each kind's noun (owner-approved, session 6). */
const CLASH_NOUNS = {
  goal: "the goal", debt: "the debt", recurring: "the recurring payment", asset: "the asset",
  wishlist: "the wishlist item", category: "the category", rule: "the category rule",
} as const;

/**
 * Plan H 5d: one change both devices made, as the notice says it. Approved
 * (owner, session 5): 'Both devices changed the goal "<name>" — kept the
 * later change.' and "Both devices changed your <setting> — kept <value>
 * (the other device had <value>)." Other kinds use the goal's sentence with
 * their own noun; a pick that is not the later edit (equal times, or none)
 * claims no "later". Both approved in session 6.
 */
export function clashSentence(c: MergeClash): string {
  // Item 7: a transaction's record, in the approved transaction sentences.
  if (c.kind === "transaction") {
    const kept = noticeMoney(c.kept, c.keptCurrency), other = noticeMoney(c.other, c.otherCurrency);
    if (c.how === "newer") return `Merged with your other device — kept the newer edit to "${c.name}" (${kept}, was ${other}).`;
    return c.how === "tie"
      ? `Both devices changed "${c.name}" at the same moment — kept ${kept} (the other copy said ${other}).`
      : `Your devices had different versions of "${c.name}" — kept ${kept} (the other copy said ${other}).`;
  }
  if (c.kind === "setting") {
    return `Both devices changed your ${SETTING_NAMES[c.setting]} — kept ${settingValueText(c.setting, c.kept)} (the other device had ${settingValueText(c.setting, c.other)}).`;
  }
  return c.later
    ? `Both devices changed ${CLASH_NOUNS[c.kind]} "${c.name}" — kept the later change.`
    : `Your devices had different versions of ${CLASH_NOUNS[c.kind]} "${c.name}" — ESSA kept one of them.`;
}

/** "a", "a and b", "a, b and c": the owner's style, no comma before the last word. */
function joinNames(names: readonly string[], word: "and" | "or"): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${word} ${names[names.length - 1]}`;
}

/**
 * The merge notice's one line at three or more conflicts (owner's wording,
 * session 4): the count, "transactions" when every conflict is one and
 * "items" when they span kinds, and the first two different names. Today
 * only transactions reach the notice; SYNC-1 step 4 adds other kinds.
 */
export function collapsedConflictLine(conflicts: readonly { kind: string; name: string }[]): string {
  const noun = conflicts.every((c) => c.kind === "transaction") ? "transactions" : "items";
  const names = [...new Set(conflicts.map((c) => c.name))].slice(0, 2).map((n) => `"${n}"`);
  return `Your devices had different versions of ${conflicts.length} ${noun}, including ${joinNames(names, "and")} — ESSA kept one of each.`;
}

/**
 * When a close was made, as the notice says it: "27 Sep 2026, 11:00", local
 * time. Months are spelled as in the cycle label beside it; the runtime's
 * en-GB says "Sept" on current ICU, which would put two spellings in one
 * sentence.
 */
export function closeMomentLabel(iso: string): string {
  const d = new Date(iso);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${dayLabel(d)}, ${hm}`;
}

/** This account's sync time on this device (the signed-in account's by default), or null. */
export function getLastSyncTime(userId: string | null = getSession()?.userId ?? null): string | null {
  if (typeof window === "undefined" || !userId) return null;
  // Session 9 (owner): the old browser-wide value is no account's. It's removed
  // when found; an account with no time of its own pushes on FIRST_PUSH_BASE.
  if (localStorage.getItem(LEGACY_LAST_SYNC_KEY) !== null) localStorage.removeItem(LEGACY_LAST_SYNC_KEY);
  return localStorage.getItem(lastSyncKey(userId));
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
 * server-down moment never prevents signing up. The address goes in the
 * body, never the URL, so it stays out of the hosts' request logs (2.4.165).
 */
export async function checkEmailExists(email: string): Promise<boolean> {
  return (await serverCopyExists(email)) === true;
}

/**
 * Session 10, item 5: the same question, with "not known" kept apart: null
 * when there's no answer, an error, or an answer that isn't one. For a claim
 * that there's no copy, which only the server's own "no" supports.
 */
export async function serverCopyExists(email: string): Promise<boolean | null> {
  try {
    const res = await fetch("/api/auth/check-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await parseJsonSafe(res);
    return typeof json?.exists === "boolean" ? json.exists : null;
  } catch {
    return null;
  }
}
