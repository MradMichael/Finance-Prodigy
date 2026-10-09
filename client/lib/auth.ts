"use client";

import { toB64 as b64, fromB64 as unb64, hasActiveKey, clearEncryptionKey, clearSyncToken, getActiveDek, sealWithDek, openWithDek } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// ESSA — local auth layer (localStorage, no backend required)
// Each user's financial data is namespaced under their unique ID so records
// are completely isolated. Swap the localStorage calls for API calls once
// a real database + JWT backend is wired up.
// ─────────────────────────────────────────────────────────────────────────────

const USERS_KEY   = "essa_users_v1";
const SESSION_KEY = "essa_session_v1";

export interface StoredUser {
  id:        string;
  email:     string;
  name:      string;
  pwHash:    string;
  createdAt: string;
  isAdmin?:  boolean;
  /** Data-encryption key wrapped under the password / a recovery code. Absent on accounts created before recovery codes existed — migrated on next sign-in. */
  wrappedDekPassword?: import("./crypto").Envelope;
  wrappedDekRecovery?: import("./crypto").Envelope;
  /**
   * The token derived from the current recovery code (deriveRecoveryToken),
   * ENCRYPTED under this account's data key (sealWithDek). SEC-01 / FB-1b:
   * this is not a verifier like pwHash -- it's the exact secret the server
   * checks at /relink, so whoever reads it can relink the account to tokens of
   * their own. It used to be stored in plain text, readable after sign-out.
   * Sent with a push so the server can register it on first sync. Since
   * FB-1b2 it's also the proof regenerateRecoveryCode gives /relink to replace
   * the server's code with a new one. Recovery itself never reads it: it
   * derives its proof from the code the user types. It can be opened only
   * while the account is unlocked. Absent on devices that joined by signing
   * in, and on accounts older than recovery codes.
   */
  recoveryTokenEnc?: string;
  /**
   * LEGACY: the same token in plain text, as devices stored it before FB-1b.
   * Never written any more. Read only to migrate it into recoveryTokenEnc on
   * the device's next unlock, and deleted in the same write.
   */
  recoveryTokenForSync?: string;
}

/** A record without the legacy plaintext token. Every writer of the token goes through this. */
function withoutLegacyToken(u: StoredUser): StoredUser {
  const { recoveryTokenForSync: _legacy, ...rest } = u;
  return rest;
}

/**
 * Moves a pre-FB-1b plaintext token into recoveryTokenEnc, under `dek` (this
 * account's own data key, already unlocked by the caller). The plaintext goes
 * only after the sealed copy has been opened again and matched, in the same
 * write that stores it. Any failure leaves the record exactly as it was, so
 * the token is never lost and the next unlock tries again.
 */
async function migrateLegacyRecoveryToken(userId: string, dek: Uint8Array): Promise<void> {
  const user = getUsers().find((u) => u.id === userId);
  const legacy = user?.recoveryTokenForSync;
  if (!user || !legacy) return;
  try {
    const sealed = await sealWithDek(dek, legacy);
    if ((await openWithDek(dek, sealed)) !== legacy) return;
    putUsers(getUsers().map((u) => (u.id === userId ? withoutLegacyToken({ ...u, recoveryTokenEnc: sealed }) : u)));
  } catch {
    // Left as it was: the plaintext still works, and the next unlock retries.
  }
}

export interface Session {
  userId: string;
  email:  string;
  name:   string;
}

// PBKDF2-SHA256 with a random per-account salt, so a leaked essa_users_v1
// blob can't be cracked with a lookup table and is slow to brute-force.
// Stored as "pbkdf2:<saltB64>:<hashB64>".
const PBKDF2_ITERATIONS = 120_000;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt);
  return `pbkdf2:${b64(salt)}:${b64(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltB64, hashB64] = stored.split(":");
  if (!saltB64 || !hashB64) return false;
  const salt = unb64(saltB64);
  const bits = await deriveBits(password, salt);
  return constantTimeEqual(b64(new Uint8Array(bits)), hashB64);
}

// Plain `===` on a derived hash short-circuits at the first mismatched
// character, so comparison time can correlate with how many leading bytes
// match. Both compared strings are fixed-length (base64 of a fixed digest
// size), so the length check below leaks nothing that isn't already public.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function deriveBits(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
}

// Legacy djb2 hash — kept only to verify + silently upgrade pre-existing
// accounts on their next successful sign-in. Never used for new accounts.
function legacyHashPw(pw: string): string {
  let h = 5381;
  for (let i = 0; i < pw.length; i++) h = (Math.imul(h, 33) ^ pw.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function getUsers(): StoredUser[] {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) ?? "[]"); }
  catch { return []; }
}

function putUsers(users: StoredUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export async function signUp(
  email: string, name: string, password: string,
): Promise<{ ok: true; recoveryCode: string } | { ok: false; error: string }> {
  if (!email.trim() || !name.trim() || !password) return { ok: false, error: "All fields are required." };
  // The server's sync API validates email format strictly (zod's .email()) —
  // without a matching check here, someone could sign up locally with a
  // non-standard string ("test", "admin@localhost") that works fine until
  // their first sync attempt, which would then fail with a confusing 422
  // for a problem that traces back to account creation, not sync itself.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { ok: false, error: "Enter a valid email address." };
  if (password.length < 10) return { ok: false, error: "Password must be at least 10 characters." };
  const users = getUsers();
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase().trim()))
    return { ok: false, error: "An account with this email already exists." };

  // The account id doubles as the salt for every KEK derivation (see
  // crypto.ts) — it needs real entropy, not just uniqueness. Math.random()
  // isn't a CSPRNG and would weaken that salt, so a browser/context missing
  // crypto.randomUUID (very old browser, or non-HTTPS) fails loudly here
  // rather than silently signing up with a weaker security foundation.
  if (!crypto.randomUUID) return { ok: false, error: "This browser doesn't support the security features ESSA needs. Please use an up-to-date browser over HTTPS." };
  const id = crypto.randomUUID();
  const normalizedEmail = email.toLowerCase().trim();
  const { createEnvelopes, deriveRecoveryToken } = await import("./crypto");
  const [{ wrappedPassword, wrappedRecovery, recoveryCode, dek }, pwHash] = await Promise.all([
    createEnvelopes(password, id),
    hashPassword(password),
  ]);
  // Kept so a future sync push can register it server-side (see
  // syncService.ts). Sealed under the new account's own data key, because
  // it's the secret /relink checks, not a harmless derivation (SEC-01).
  const recoveryTokenEnc = await sealWithDek(dek, await deriveRecoveryToken(recoveryCode, normalizedEmail));

  putUsers([...users, {
    id,
    email:     normalizedEmail,
    name:      name.trim(),
    pwHash,
    createdAt: new Date().toISOString(),
    isAdmin:   users.length === 0, // first account registered is admin
    wrappedDekPassword: wrappedPassword,
    wrappedDekRecovery: wrappedRecovery,
    recoveryTokenEnc,
  }]);
  return { ok: true, recoveryCode };
}

/**
 * Handles signIn's "no local account for this email" case. Derives the sync
 * token straight from the entered password (same derivation initSyncToken
 * uses) and tries a pull with it — the server only accepts a pull whose
 * token matches what a previous push registered, so a successful pull is
 * itself proof this is the right password for a real, previously-synced
 * account. On success, provisions a brand-new local account for this
 * device (a fresh device always needs its own local DEK envelope; only the
 * plaintext sync backup is portable) and adopts the pulled data as-is, the
 * same end state "sign up, then Pull" already produces manually.
 */
async function signInFromSync(
  email: string, password: string,
): Promise<{ ok: true; session: Session; recoveryCode?: string } | { ok: false; error: string }> {
  if (!password) return { ok: false, error: "No account found with this email." };
  const normalizedEmail = email.toLowerCase().trim();
  const { initSyncToken, createEnvelopes, activateSessionKey } = await import("./crypto");
  await initSyncToken(password, normalizedEmail);
  const { pullFromServer } = await import("./syncService");
  const pulled = await pullFromServer(normalizedEmail);
  if (!pulled.ok) {
    // Distinguish the three real cases instead of one blanket message: the
    // server's /pull already tells them apart (404 = nothing registered
    // for this email at all, 401 = registered but this token, i.e. this
    // password, doesn't match it), and conflating "wrong password" with
    // "no account anywhere" sends someone with a typo down the wrong path
    // (trying to sign up fresh) instead of the right one (retyping it).
    if (pulled.error.includes("Invalid sync credentials")) {
      return { ok: false, error: "Incorrect password for this email." };
    }
    if (pulled.error.includes("No data on server yet") || pulled.error.includes("No sync data found") || pulled.error.includes("no sync credentials registered")) {
      return { ok: false, error: "No account found with this email. Check the email, or sign up if this is your first time." };
    }
    return { ok: false, error: `Couldn't verify your account right now (${pulled.error}). Check your connection and try again.` };
  }

  // 2.4.37: this browser may already hold real data under some OTHER local
  // account whose own confirmCutoverDate/etc. this pull-triggered path knows
  // nothing about -- but more importantly, if `essa_users_v1` lost track of
  // THIS email's own prior local record (a private window, a cleared
  // browser, a session hiccup), the device can still be sitting on real
  // data that a silent restore would orphan or feel like it erased. No
  // specific userId is established yet at this point in the flow, so this
  // is the coarse check -- see hasAnyLocalData's own comment for the
  // false-positive tradeoff. Confirmed live: this exact gap, unguarded,
  // silently reverted a real debt payment and ~12 transactions (2.4.33).
  const { confirmOverwriteIfNeeded } = await import("./syncService");
  if (!(await confirmOverwriteIfNeeded(undefined, "your account on the server"))) {
    return { ok: false, error: "Cancelled — nothing on this device was changed." };
  }

  if (!crypto.randomUUID) return { ok: false, error: "This browser doesn't support the security features ESSA needs. Please use an up-to-date browser over HTTPS." };
  const id = crypto.randomUUID();
  const [{ wrappedPassword, wrappedRecovery, recoveryCode, dek }, pwHash] = await Promise.all([
    createEnvelopes(password, id),
    hashPassword(password),
  ]);
  const name = pulled.data.userName || normalizedEmail.split("@")[0];
  const users = getUsers();
  putUsers([...users, {
    id,
    email:     normalizedEmail,
    name,
    pwHash,
    createdAt: new Date().toISOString(),
    isAdmin:   users.length === 0,
    wrappedDekPassword: wrappedPassword,
    wrappedDekRecovery: wrappedRecovery,
  }]);

  const session: Session = { userId: id, email: normalizedEmail, name };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  activateSessionKey(dek);

  const { saveData } = await import("./localData");
  await saveData({ ...pulled.data, userName: name }, id);
  // Plan H 5b: stored, so this is the last sync the next merge compares against.
  await (await import("./syncSeen")).saveSeen(id, pulled.data);
  // Session 7: a joining device takes the copy's clash records as already shown.
  await (await import("./clashNotice")).takeUnseenClashes(id, pulled.data, undefined, { firstSync: true });

  // This device still needs its own local wrapped-DEK envelope (created
  // above) to unlock its own encrypted storage later, but only surface the
  // fresh recovery code -- and so only show the "save this" modal -- when
  // the account doesn't already have one registered server-side. Otherwise
  // every subsequent device shows a brand-new code forever, not once.
  return { ok: true, session, recoveryCode: pulled.hasRecoveryCode ? undefined : recoveryCode };
}

export async function signIn(
  email: string, password: string,
): Promise<{ ok: true; session: Session; recoveryCode?: string } | { ok: false; error: string }> {
  const user = getUsers().find((u) => u.email === email.toLowerCase().trim());
  // No local account for this email on this device — the common case is a
  // second device (new phone) for an email that's only ever signed up
  // elsewhere. There's no local password hash to check yet, but a
  // successful pull using the password-derived sync token is equally
  // strong proof the password is correct: a wrong password derives a
  // different token and the server rejects it. See signInFromSync.
  if (!user) return signInFromSync(email, password);

  let valid: boolean;
  if (user.pwHash.startsWith("pbkdf2:")) {
    valid = await verifyPassword(password, user.pwHash);
  } else {
    // Pre-existing account from before PBKDF2 hashing. legacyHashPw is a
    // 32-bit unsalted checksum — too weak to trust on its own (brute-forceable
    // in well under a minute), and a "successful" match here used to
    // immediately overwrite the account's password hash AND re-derive/persist
    // its encryption key from whatever string was entered, so a forged
    // collision could permanently corrupt a real user's data with no way
    // back. Use it only as a cheap pre-filter, then require the candidate
    // password to actually decrypt this account's real stored data before
    // trusting it (verifyLegacyPassword returns null only when there's no
    // stored data yet to check against — the one case with nothing at stake).
    // AUD-16 (external audit, 2026-08-28): plain === short-circuits at the
    // first mismatched character; constantTimeEqual is what every other
    // secret comparison in this file already uses.
    const quickCheck = constantTimeEqual(legacyHashPw(password), user.pwHash);
    if (!quickCheck) return { ok: false, error: "Incorrect password." };
    const { verifyLegacyPassword } = await import("./crypto");
    const verified = await verifyLegacyPassword(password, user.id);
    // verified === null means there's no stored encrypted data to check the
    // candidate password against at all (this device's legacy account was
    // never actually used) — deliberately still let sign-in proceed rather
    // than permanently lock out that edge case (this account predates
    // recovery codes too, so there'd be no way back in otherwise). Written
    // as an explicit === true || === null rather than the equivalent
    // !== false, since a reader skimming this needs "null is intentionally
    // accepted" to be obvious, not an inference from what it isn't. Still
    // upgrading pwHash here (not gating it on verified === true) is also
    // deliberate: quickCheck alone is a weak, brute-forceable checksum, but
    // leaving the account on that same weak format forever so this
    // hypothetical attacker's one shot is "safer" is backwards — it would
    // leave every future sign-in attempt exposed to the identical gap
    // instead of closing it after this one.
    valid = verified === true || verified === null;
    if (valid) {
      const upgraded = await hashPassword(password);
      putUsers(getUsers().map((u) => (u.id === user.id ? { ...u, pwHash: upgraded } : u)));
    }
  }
  if (!valid) return { ok: false, error: "Incorrect password." };

  const { unwrapWithPassword, migrateLegacyEnvelope, activateSessionKey, initSyncToken } = await import("./crypto");

  // Independent of the DEK unwrap/migration below (only needs password +
  // email) — kick it off concurrently instead of waiting for that first.
  const syncTokenPromise = initSyncToken(password, user.email);

  let dek: Uint8Array | null;
  let recoveryCode: string | undefined;
  if (user.wrappedDekPassword) {
    dek = await unwrapWithPassword(password, user.id, user.wrappedDekPassword);
    if (!dek) return { ok: false, error: "Could not unlock your data. Try again or use account recovery." };
  } else {
    // Pre-existing account from before recovery codes — migrate now that we
    // have the password. Existing encrypted data decrypts unchanged since
    // the DEK equals what already protected it (see migrateLegacyEnvelope).
    const migrated = await migrateLegacyEnvelope(password, user.id);
    dek = migrated.dek;
    recoveryCode = migrated.recoveryCode;
    putUsers(getUsers().map((u) => (u.id === user.id
      ? { ...u, wrappedDekPassword: migrated.wrappedPassword, wrappedDekRecovery: migrated.wrappedRecovery }
      : u)));
  }

  await syncTokenPromise;
  const session: Session = { userId: user.id, email: user.email, name: user.name };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  activateSessionKey(dek);
  // FB-1b: this device's first unlock since the change -- move any plaintext
  // recovery token into its encrypted form while the key is here to do it.
  await migrateLegacyRecoveryToken(user.id, dek);
  return { ok: true, session, recoveryCode };
}

/**
 * Issues a fresh recovery code for the CURRENTLY signed-in account, for a
 * user who lost/never saved the original and wants a new one while they
 * still know they're safely logged in — not a password reset, and doesn't
 * need one: it only re-wraps the already-unlocked session DEK under a new
 * code, using getActiveDek() rather than the plaintext password (which a
 * normal signed-in session never has lying around to begin with). The
 * original code cannot be recovered or displayed again by design — it was
 * never stored anywhere, only used once to derive a wrapping key — so this
 * is the only way back for someone who's lost it, not a workaround for one.
 *
 * FB-1b2 (SEC-09): SERVER FIRST, AND THE CODE IS SHOWN ONLY ON SUCCESS.
 * This used to re-wrap locally and leave Profile to push, and a push keeps an
 * already-registered recovery hash (server/src/routes/sync.ts:177). So with
 * backup on, the old code kept passing /relink and the new one, the one the
 * owner had just saved, failed. Now the new code exists in memory only until:
 *   - a server copy holds a code: /relink's existing old-token branch has
 *     replaced it (sync.ts:309-318), with this device's stored token as the
 *     proof and the password token the probe just proved current; or
 *   - there's no server copy for the code to matter to.
 * Every other outcome refuses, writes nothing anywhere, and says why. Relink
 * is never called without a server row, so its fresh-registration branch
 * (2.4.160) is never reached from here.
 *
 * It ALWAYS asks the server, whatever the recorded backup state (owner,
 * 2026-10-06). This device can never know that nothing exists: another
 * device can create a copy at any time. It's a rare, explicit action, unlike
 * COPY-11's background request. The wording is in recoveryMessages.ts.
 */
export async function regenerateRecoveryCode(
  userId: string,
): Promise<{ ok: true; recoveryCode: string; note?: string } | { ok: false; error: string }> {
  const { getActiveDek, rewrapRecoveryOnly, deriveRecoveryToken, getSyncToken } = await import("./crypto");
  const { REGENERATE } = await import("./recoveryMessages");
  const locked = "Your session isn't fully unlocked. Sign out and back in, then try again.";
  const dek = getActiveDek();
  if (!dek) return { ok: false, error: locked };
  const user = getUsers().find((u) => u.id === userId);
  if (!user) return { ok: false, error: "Account not found." };
  const { loadData, syncAllowed, saveFailureKind, SAVE_FAILURE_REASON } = await import("./localData");
  const data = await loadData(userId);

  // In memory only, until the server has taken it or there's nothing there to take it.
  const { wrappedRecovery, recoveryCode } = await rewrapRecoveryOnly(dek, userId);
  const newToken = await deriveRecoveryToken(recoveryCode, user.email);
  const recoveryTokenEnc = await sealWithDek(dek, newToken);
  const keep = () => putUsers(getUsers().map((u) => (u.id === userId
    ? withoutLegacyToken({ ...u, wrappedDekRecovery: wrappedRecovery, recoveryTokenEnc })
    : u)));
  const keepHereOnly = (note: string): { ok: true; recoveryCode: string; note: string } | { ok: false; error: string } => {
    try { keep(); } catch (err) { return { ok: false, error: REGENERATE.notStored(SAVE_FAILURE_REASON[saveFailureKind(err)]) }; }
    return { ok: true, recoveryCode, note };
  };

  const syncToken = getSyncToken();
  if (!syncToken) return { ok: false, error: locked };
  const { probeServerCopy, relinkSync } = await import("./syncService");
  const probe = await probeServerCopy(user.email);
  if (probe.kind === "unreachable") return { ok: false, error: REGENERATE.unreachable };
  if (probe.kind === "wrong-password") return { ok: false, error: REGENERATE.newerPassword };
  if (probe.kind === "none") return keepHereOnly(syncAllowed(data) ? REGENERATE.noCopyYet : REGENERATE.noServerCopy);
  // /relink refuses a row with no recovery hash whatever it's sent (sync.ts:301).
  if (probe.kind === "unregistered" || !probe.hasRecoveryCode) return { ok: false, error: REGENERATE.noCodeRegistered };

  const current = await getRecoveryTokenForSync(user.email);
  if (!current) return { ok: false, error: REGENERATE.notOnThisDevice };
  const relinked = await relinkSync(user.email, syncToken, newToken, current);
  if (!relinked.ok) {
    return { ok: false, error: relinked.error?.includes("verify ownership") ? REGENERATE.notTheBackupsCode : REGENERATE.unreachable };
  }
  // The server has it, and the old code is dead there. A failed write here
  // still shows the code, because it works (see acceptedNotStored).
  try { keep(); } catch { return { ok: true, recoveryCode, note: REGENERATE.acceptedNotStored }; }
  return { ok: true, recoveryCode };
}

/**
 * Handles recoverAccount's "no local account for this email" case — the
 * recovery-code counterpart to signInFromSync. A brand-new device has no
 * local envelope to unwrap with the recovery code, so instead this proves
 * ownership straight to the server: derives the token for the *old*
 * recovery code and calls /relink, which was already built to rotate sync
 * credentials after a password reset but had never been reachable from a
 * device with zero local state. That registers a fresh sync token (from
 * newPassword) and a fresh recovery token in one step, without ever
 * checking the old password/token — sidesteps entirely whatever caused a
 * password-based sign-in to disagree with the server. Once relinked, pulls
 * the account's data the same way signInFromSync does and provisions a
 * local account for this device around it.
 *
 * `existingId`, when given, means the caller already has a LOCAL record
 * for this email whose own envelope just failed to unwrap with the typed
 * code (see recoverAccount below — a signInFromSync-joined or otherwise
 * mismatched device, 2.2.12). In that case this replaces that record in
 * place instead of appending a second one for the same email.
 */
async function recoverFromSync(
  email: string, recoveryCode: string, newPassword: string, existingId?: string,
): Promise<{ ok: true; session: Session; newRecoveryCode: string } | { ok: false; error: string }> {
  if (newPassword.length < 10) return { ok: false, error: "Password must be at least 10 characters." };
  const normalizedEmail = email.toLowerCase().trim();
  const { createEnvelopes, activateSessionKey, initSyncToken, deriveRecoveryToken } = await import("./crypto");
  const { relinkSync, pullFromServer } = await import("./syncService");

  const oldRecoveryToken = await deriveRecoveryToken(recoveryCode, normalizedEmail);

  if (!existingId && !crypto.randomUUID) return { ok: false, error: "This browser doesn't support the security features ESSA needs. Please use an up-to-date browser over HTTPS." };
  const id = existingId ?? crypto.randomUUID();
  const [{ wrappedPassword, wrappedRecovery, recoveryCode: newRecoveryCode, dek }, pwHash, newToken] = await Promise.all([
    createEnvelopes(newPassword, id),
    hashPassword(newPassword),
    initSyncToken(newPassword, normalizedEmail),
  ]);
  const newRecoveryToken = await deriveRecoveryToken(newRecoveryCode, normalizedEmail);

  const relinked = await relinkSync(normalizedEmail, newToken, newRecoveryToken, oldRecoveryToken);
  if (!relinked.ok) {
    if (relinked.error?.includes("verify ownership")) {
      return { ok: false, error: "No account found with this email, or that recovery code doesn't match it." };
    }
    return { ok: false, error: `Couldn't reach the server right now (${relinked.error}). Check your connection and try again.` };
  }

  const pulled = await pullFromServer(normalizedEmail);
  if (!pulled.ok) {
    return { ok: false, error: `Your password was reset, but retrieving your data failed (${pulled.error}). Try signing in now — the new password should work.` };
  }

  const name = pulled.data.userName || normalizedEmail.split("@")[0];
  const users = getUsers();
  const existing = existingId ? users.find((u) => u.id === existingId) : undefined;
  const record: StoredUser = {
    id,
    email:     normalizedEmail,
    name,
    pwHash,
    // Preserve this device's own history when replacing an existing
    // record rather than resetting it — only a genuinely new entry gets a
    // fresh createdAt/isAdmin-by-arrival-order.
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    isAdmin:   existing?.isAdmin ?? users.length === 0,
    wrappedDekPassword: wrappedPassword,
    wrappedDekRecovery: wrappedRecovery,
    recoveryTokenEnc: await sealWithDek(dek, newRecoveryToken),
  };
  // 2.4.37: `existingId` means a local record for this email already exists
  // on this device (its own envelope just failed to unwrap with the typed
  // code) -- a KNOWN userId, so the precise check applies, same as
  // handlePull's. Without `existingId`, same coarse case as
  // signInFromSync's own guard just above.
  const { confirmOverwriteIfNeeded } = await import("./syncService");
  if (!(await confirmOverwriteIfNeeded(existingId, "your account on the server"))) {
    return { ok: false, error: "Cancelled — nothing on this device was changed." };
  }

  putUsers(existing ? users.map((u) => (u.id === existingId ? record : u)) : [...users, record]);

  const session: Session = { userId: id, email: normalizedEmail, name };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  activateSessionKey(dek);

  const { saveData } = await import("./localData");
  await saveData({ ...pulled.data, userName: name }, id);
  // Plan H 5b: stored, so this is the last sync the next merge compares against.
  await (await import("./syncSeen")).saveSeen(id, pulled.data);
  // Session 7: a joining device takes the copy's clash records as already shown.
  await (await import("./clashNotice")).takeUnseenClashes(id, pulled.data, undefined, { firstSync: true });

  return { ok: true, session, newRecoveryCode };
}

/**
 * Resets the password using a recovery code, without losing access to
 * already-encrypted data (the DEK itself never changes, only how it's
 * wrapped). Issues a new recovery code — the old one stops working.
 *
 * The relink proof (oldRecoveryToken) is derived FRESH from the recovery
 * code just typed in, not read from a locally-cached copy
 * (recoveryTokenForSync) — identical result whenever the cache would have
 * been right (both are the same deterministic derivation), but no longer
 * DEPENDS on that cache existing at all. Two real device shapes never set
 * it: a device that joined via signInFromSync (mints its own local-only
 * recovery code — see recoverFromSync's doc comment and 2.2.12), and a
 * legacy account migrating on sign-in (migrateLegacyEnvelope). Previously
 * recovery on those devices either silently skipped the server-side
 * rotation (2.2.11) or failed outright even with the correct code
 * (2.2.12) — see docs/AUDIT_2026-08.md, Amendment 3, for the live-tested
 * detail behind both.
 *
 * relinkSync is required and awaited, not fire-and-forget: a reset that
 * silently leaves the server trusting the OLD token indefinitely was
 * exactly the bug this replaces. If this device's own envelope doesn't
 * unwrap with the typed code, that doesn't mean the code is wrong — the
 * server, not this device's local state, is the real authority — so this
 * falls through to the same server-verified path recoverFromSync already
 * uses for a brand-new device, just replacing this device's mismatched
 * local record instead of appending a duplicate one.
 */
export async function recoverAccount(
  email: string, recoveryCode: string, newPassword: string,
): Promise<{ ok: true; session: Session; newRecoveryCode: string } | { ok: false; error: string }> {
  if (newPassword.length < 10) return { ok: false, error: "Password must be at least 10 characters." };
  const user = getUsers().find((u) => u.email === email.toLowerCase().trim());
  if (!user) return recoverFromSync(email, recoveryCode, newPassword);
  if (!user.wrappedDekRecovery) {
    return { ok: false, error: "Recovery isn't set up for this account yet. It needs one successful sign-in first." };
  }

  const { unwrapWithRecoveryCode, rewrapEnvelopes, activateSessionKey, initSyncToken, deriveRecoveryToken } = await import("./crypto");
  const dek = await unwrapWithRecoveryCode(recoveryCode, user.id, user.wrappedDekRecovery);

  if (!dek) {
    const fallback = await recoverFromSync(email, recoveryCode, newPassword, user.id);
    if (!fallback.ok && fallback.error.includes("recovery code doesn't match")) {
      // Reword for this branch specifically: unlike recoverFromSync's usual
      // caller (a genuinely unknown email), there IS a local account here —
      // the code itself was simply wrong, which is what the user needs to hear.
      return { ok: false, error: "Invalid recovery code." };
    }
    return fallback;
  }

  // All independent (only need dek/newPassword/email) — run concurrently.
  const [{ wrappedPassword, wrappedRecovery, recoveryCode: newRecoveryCode }, newPwHash, newToken] = await Promise.all([
    rewrapEnvelopes(dek, newPassword, user.id),
    hashPassword(newPassword),
    initSyncToken(newPassword, user.email),
  ]);
  const oldRecoveryToken = await deriveRecoveryToken(recoveryCode, user.email);
  const newRecoveryTokenForSync = await deriveRecoveryToken(newRecoveryCode, user.email);

  const { relinkSync } = await import("./syncService");
  const relinked = await relinkSync(user.email, newToken, newRecoveryTokenForSync, oldRecoveryToken);
  if (!relinked.ok) {
    if (relinked.error?.includes("verify ownership")) {
      return { ok: false, error: "Invalid recovery code." };
    }
    return { ok: false, error: `Your password wasn't reset — couldn't verify it with the server (${relinked.error}). Check your connection and try again.` };
  }

  const recoveryTokenEnc = await sealWithDek(dek, newRecoveryTokenForSync);
  putUsers(getUsers().map((u) => (u.id === user.id
    ? withoutLegacyToken({ ...u, pwHash: newPwHash, wrappedDekPassword: wrappedPassword, wrappedDekRecovery: wrappedRecovery, recoveryTokenEnc })
    : u)));

  const session: Session = { userId: user.id, email: user.email, name: user.name };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  activateSessionKey(dek);
  return { ok: true, session, newRecoveryCode };
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null"); }
  catch { return null; }
}

/**
 * True only when there's BOTH a persisted session (localStorage) AND a live
 * encryption key for it (sessionStorage) — the two live in different
 * storages with different lifetimes on purpose (session persists across
 * restarts; the key is scoped to the current browser session for security).
 * That gap used to let pages treat "session exists" as "safe to load/save
 * data," which could silently corrupt real encrypted data after a browser
 * restart or in a fresh tab. Callers that touch loadData/saveData should
 * gate on this, not on getSession() alone.
 */
export function hasValidSession(): boolean {
  return getSession() !== null && hasActiveKey();
}

export function signOut(): void {
  localStorage.removeItem(SESSION_KEY);
  // TEST-01 / FB-1b: cleared before this returns. They used to be cleared in
  // a dynamic import's .then(), a later microtask -- and the data key is what
  // opens the stored recovery token, so it mustn't outlive the sign-out.
  try {
    clearEncryptionKey();
    clearSyncToken();
  } catch { /* storage unavailable: nothing there to clear */ }
}

/**
 * The current recovery-derived token for this email, for a push to register
 * server-side (see syncService.ts). Readable only in an unlocked session that
 * belongs to this account: otherwise undefined, by design (SEC-01). A device
 * still holding the pre-FB-1b plaintext migrates it here, and gets the token
 * back whether or not the migration succeeds -- it's never lost.
 */
export async function getRecoveryTokenForSync(email: string): Promise<string | undefined> {
  const user = getUsers().find((u) => u.email === email.toLowerCase().trim());
  const dek = getActiveDek();
  // The active key must be THIS account's: a device can hold several local
  // accounts, and another's key must never seal or open this one's token.
  if (!user || !dek || getSession()?.userId !== user.id) return undefined;
  if (user.recoveryTokenForSync) {
    const legacy = user.recoveryTokenForSync;
    await migrateLegacyRecoveryToken(user.id, dek);
    return legacy;
  }
  if (!user.recoveryTokenEnc) return undefined;
  return (await openWithDek(dek, user.recoveryTokenEnc)) ?? undefined;
}

export function updateProfile(userId: string, name: string): void {
  putUsers(getUsers().map((u) => u.id === userId ? { ...u, name } : u));
  const s = getSession();
  if (s?.userId === userId) localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, name }));
}

// 2.2.18: used to be fire-and-forget -- a server-cleanup failure (offline,
// server down) was never surfaced anywhere, so the user saw "account
// deleted" succeed locally with no way to know a copy might still be
// sitting on the server. Local deletion above is still what actually
// matters and is NOT gated on this -- it's already done, synchronously,
// by the time the (bounded-timeout, via deleteFromServer's own
// AbortSignal.timeout) server call even starts. This only reports whether
// that server half also succeeded, so the caller can tell the user rather
// than silently losing that information.
export async function deleteAccount(userId: string): Promise<{ serverCleanupOk: boolean }> {
  const user = getUsers().find((u) => u.id === userId);
  putUsers(getUsers().filter((u) => u.id !== userId));
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(`essa_data_${userId}`);
  // Plan H 5b: this device's sync fingerprints (lib/syncSeen.ts) go with it.
  localStorage.removeItem(`essa_seen_${userId}`);
  // Plan H 5d: and its memory of the clash notices it has shown (lib/clashNotice.ts).
  localStorage.removeItem(`essa_clashes_shown_${userId}`);

  if (!user) return { serverCleanupOk: true }; // nothing local to have synced in the first place
  try {
    const { getSyncToken } = await import("./crypto");
    const token = getSyncToken();
    if (!token) return { serverCleanupOk: true }; // never synced -- nothing on the server to remove
    const { deleteFromServer } = await import("./syncService");
    const result = await deleteFromServer(user.email, token);
    return { serverCleanupOk: result.ok };
  } catch {
    return { serverCleanupOk: false };
  }
}

export function isAdmin(userId: string): boolean {
  return getUsers().find((u) => u.id === userId)?.isAdmin === true;
}

export function listUsers(): Pick<StoredUser, "id" | "email" | "name" | "createdAt" | "isAdmin">[] {
  return getUsers().map(({ id, email, name, createdAt, isAdmin }) => ({ id, email, name, createdAt, isAdmin }));
}

/** Promote an existing account (first-run migration for accounts created before isAdmin existed). */
export function ensureFirstUserIsAdmin(): void {
  const users = getUsers();
  if (users.length > 0 && !users.some((u) => u.isAdmin)) {
    putUsers(users.map((u, i) => i === 0 ? { ...u, isAdmin: true } : u));
  }
}
