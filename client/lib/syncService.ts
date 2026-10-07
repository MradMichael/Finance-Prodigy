"use client";

import type { LocalFinancials, StoredTransaction } from "./localData";
import { mergeFinancials, stableStringify, MERGED_FIELDS, type MergeFinancialsResult } from "./syncMerge";
import { cycleLabelLong, dayLabel } from "./period";
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
  const recoveryToken = await getRecoveryTokenForSync(email);
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
): Promise<{ ok: true; data: LocalFinancials; syncedAt: string; hasRecoveryCode: boolean } | { ok: false; error: string; notFound?: true }> {
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
    if (record) localStorage.setItem(LAST_SYNC_KEY, json.syncedAt);
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
  | { ok: true; syncedAt: string; addedFromServer: number; conflictsResolved: number; conflicts: StoredTransaction[]; conflictDetails: MergeConflictDetail[]; nonTransactionDivergence: string[]; replacedCloses: ReplacedCloseNotice[]; mergedData: LocalFinancials }
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

  // SYNC-1 step 2: the whole merge, not transactions alone. The wishlist,
  // categories, rules, tracked balances and period closes merge too
  // (lib/syncMerge.ts); everything else keeps this device's copy, as before.
  const result = mergeFinancials(local, pulled.data, new Date());
  const merged = result.transactions;
  const mergedData: LocalFinancials = result.data;
  // Detected against local's PRE-merge copy vs. the server's copy -- what
  // actually diverged between the two devices, for the fields that still
  // keep this device's copy.
  const nonTransactionDivergence = detectNonTransactionDivergence(local, pulled.data);
  const { conflictDetails, replacedCloses } = describeMerge(result);

  const pushed = await pushToServer(email, mergedData);
  if (!pushed.ok) return { ok: false, error: pushed.error ?? "Merge succeeded locally, but push failed.", conflict: pushed.conflict };

  return {
    ok: true,
    syncedAt: pushed.syncedAt!,
    addedFromServer: merged.addedFromServer,
    conflictsResolved: merged.conflictsResolved,
    conflicts: merged.conflicts,
    conflictDetails,
    nonTransactionDivergence,
    replacedCloses,
    mergedData,
  };
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
      /** The merge brought something this device didn't have. */
      localChanged: boolean;
      /** The merged copy holds something the server lacks, in the fields that merge. */
      serverBehind: boolean;
      addedFromServer: number;
      conflictDetails: MergeConflictDetail[];
      replacedCloses: ReplacedCloseNotice[];
    }
  | { ok: false; error: string; notFound?: true };

/** The same records, whatever order the two copies hold them in. */
function sameRecords(a: LocalFinancials, b: LocalFinancials): boolean {
  const canon = (d: LocalFinancials, k: (typeof MERGED_FIELDS)[number]) => {
    const v = d[k];
    return Array.isArray(v) ? v.map((x) => stableStringify(x)).sort() : stableStringify(v ?? {});
  };
  return MERGED_FIELDS.every((k) => stableStringify(canon(a, k)) === stableStringify(canon(b, k)));
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
  const pulled = await pullFromServer(email, { record: false, timeoutMs: FETCH_TIMEOUT_MS });
  if (!pulled.ok) return { ok: false, error: pulled.error, ...(pulled.notFound ? { notFound: true as const } : {}) };
  const local = currentLocal();
  if (!local) return { ok: true, skipped: true };
  const result = mergeFinancials(local, pulled.data, new Date());
  return {
    ok: true,
    mergedData: result.data,
    localChanged: !sameRecords(result.data, local),
    serverBehind: !sameRecords(result.data, pulled.data),
    addedFromServer: result.transactions.addedFromServer,
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
  // SYNC-1 step 2: a close made on this device that another device's
  // earlier close of the same cycle replaced. Told plainly, because the owner
  // made it and it was undone.
  replacedCloses: ReplacedCloseNotice[] = [],
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
  // and two copies with no time at all in the DRAFT below.
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
  const edits = described.filter(isNewer);
  const undated = described.filter((d) => !isNewer(d));
  const n = edits.length;
  let showReviewLink = false;
  const describe = (d: MergeConflictDetail) =>
    `kept the newer edit to "${d.winner.description}" (${fmtMoney(d.winner.amount)}, was ${fmtMoney(d.loser.amount)})`;
  if (n === 1) {
    parts.push(describe(edits[0]));
  } else if (n === 2) {
    parts.push(edits.map(describe).join(" and "));
  } else if (n >= 3) {
    parts.push(`${n} edit conflicts resolved (kept the most recent edit each time)`);
    showReviewLink = true;
  }
  const mainText = parts.length > 0 ? `Merged with your other device — ${parts.join(", ")}.` : "";

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
    ...undated.map((d) => isTie(d)
      ? `Both devices changed "${d.winner.description}" at the same moment — kept ${fmtMoney(d.winner.amount)} (the other copy said ${fmtMoney(d.loser.amount)}).`
      // DRAFT (held for the owner): the tie sentence without "at the same moment", which no edit time can support.
      : `Both devices changed "${d.winner.description}" — kept ${fmtMoney(d.winner.amount)} (the other copy said ${fmtMoney(d.loser.amount)}).`),
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

/** "a", "a and b", "a, b and c": the owner's style, no comma before the last word. */
function joinNames(names: readonly string[], word: "and" | "or"): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${word} ${names[names.length - 1]}`;
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
 * server-down moment never prevents signing up. The address goes in the
 * body, never the URL, so it stays out of the hosts' request logs (2.4.165).
 */
export async function checkEmailExists(email: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/check-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json.exists === true;
  } catch {
    return false;
  }
}
