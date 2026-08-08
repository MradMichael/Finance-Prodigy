"use client";

import { toB64 as b64, fromB64 as unb64, hasActiveKey } from "./crypto";

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
   * A one-way token derived from the current recovery code (deriveRecoveryToken),
   * persisted locally so it can be sent with a future sync push (registering it
   * server-side) and, after a password reset, used as proof of the *previous*
   * recovery code to re-link sync without ever sending the code itself. Safe to
   * persist — like pwHash, it's a one-way derivation, not the code. Absent on
   * accounts created before this existed.
   */
  recoveryTokenForSync?: string;
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
  const [{ wrappedPassword, wrappedRecovery, recoveryCode }, pwHash] = await Promise.all([
    createEnvelopes(password, id),
    hashPassword(password),
  ]);
  // Persisted so a future sync push can register it server-side (see
  // syncService.ts) — safe to store since it's a one-way derivation of the
  // recovery code, not the code itself.
  const recoveryTokenForSync = await deriveRecoveryToken(recoveryCode, normalizedEmail);

  putUsers([...users, {
    id,
    email:     normalizedEmail,
    name:      name.trim(),
    pwHash,
    createdAt: new Date().toISOString(),
    isAdmin:   users.length === 0, // first account registered is admin
    wrappedDekPassword: wrappedPassword,
    wrappedDekRecovery: wrappedRecovery,
    recoveryTokenForSync,
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

  return { ok: true, session, recoveryCode };
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
    const quickCheck = legacyHashPw(password) === user.pwHash;
    if (!quickCheck) return { ok: false, error: "Incorrect password." };
    const { verifyLegacyPassword } = await import("./crypto");
    const verified = await verifyLegacyPassword(password, user.id);
    valid = verified !== false;
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
 */
export async function regenerateRecoveryCode(userId: string): Promise<{ ok: true; recoveryCode: string } | { ok: false; error: string }> {
  const { getActiveDek, rewrapRecoveryOnly, deriveRecoveryToken } = await import("./crypto");
  const dek = getActiveDek();
  if (!dek) return { ok: false, error: "Your session isn't fully unlocked. Sign out and back in, then try again." };
  const user = getUsers().find((u) => u.id === userId);
  if (!user) return { ok: false, error: "Account not found." };

  const { wrappedRecovery, recoveryCode } = await rewrapRecoveryOnly(dek, userId);
  const recoveryTokenForSync = await deriveRecoveryToken(recoveryCode, user.email);
  putUsers(getUsers().map((u) => (u.id === userId
    ? { ...u, wrappedDekRecovery: wrappedRecovery, recoveryTokenForSync }
    : u)));
  return { ok: true, recoveryCode };
}

/**
 * Resets the password using a recovery code, without losing access to
 * already-encrypted data (the DEK itself never changes, only how it's
 * wrapped). Issues a new recovery code — the old one stops working.
 *
 * A password reset changes the sync token the server checks pushes/pulls
 * against. If this account had synced before AND had registered a recovery
 * token (see recoveryTokenForSync above), a best-effort relink call proves
 * ownership via the *old* recovery token and re-registers the new one —
 * see syncService.ts's relinkSync. If that registration never happened
 * (e.g. this account has never pushed), there's nothing to relink and the
 * next push will simply register fresh, same as a brand-new account.
 */
export async function recoverAccount(
  email: string, recoveryCode: string, newPassword: string,
): Promise<{ ok: true; session: Session; newRecoveryCode: string } | { ok: false; error: string }> {
  if (newPassword.length < 10) return { ok: false, error: "Password must be at least 10 characters." };
  const user = getUsers().find((u) => u.email === email.toLowerCase().trim());
  if (!user) return { ok: false, error: "No account found with this email." };
  if (!user.wrappedDekRecovery) {
    return { ok: false, error: "Recovery isn't set up for this account yet. It needs one successful sign-in first." };
  }

  const { unwrapWithRecoveryCode, rewrapEnvelopes, activateSessionKey, initSyncToken, deriveRecoveryToken } = await import("./crypto");
  const dek = await unwrapWithRecoveryCode(recoveryCode, user.id, user.wrappedDekRecovery);
  if (!dek) return { ok: false, error: "Invalid recovery code." };

  // All independent (only need dek/newPassword/email) — run concurrently.
  const [{ wrappedPassword, wrappedRecovery, recoveryCode: newRecoveryCode }, newPwHash, newToken] = await Promise.all([
    rewrapEnvelopes(dek, newPassword, user.id),
    hashPassword(newPassword),
    initSyncToken(newPassword, user.email),
  ]);
  const newRecoveryTokenForSync = await deriveRecoveryToken(newRecoveryCode, user.email);

  if (user.recoveryTokenForSync) {
    // Fire-and-forget — a real network call, best-effort. If it fails
    // (offline, server down), the known limitation persists exactly as
    // before this feature existed: the next push gets rejected until the
    // server row is cleared by hand. Not a regression, just not fixed this time.
    import("./syncService").then(({ relinkSync }) =>
      relinkSync(user.email, newToken, newRecoveryTokenForSync, user.recoveryTokenForSync)
    ).catch(() => {});
  }

  putUsers(getUsers().map((u) => (u.id === user.id
    ? { ...u, pwHash: newPwHash, wrappedDekPassword: wrappedPassword, wrappedDekRecovery: wrappedRecovery, recoveryTokenForSync: newRecoveryTokenForSync }
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
  try {
    import("./crypto").then(({ clearEncryptionKey, clearSyncToken }) => {
      clearEncryptionKey();
      clearSyncToken();
    });
  } catch { /* ignore */ }
}

/** The current recovery-derived sync token for this email, if one's been generated (see recoveryTokenForSync). Included on every push so the server can register it (see syncService.ts). */
export function getRecoveryTokenForSync(email: string): string | undefined {
  return getUsers().find((u) => u.email === email.toLowerCase().trim())?.recoveryTokenForSync;
}

export function updateProfile(userId: string, name: string): void {
  putUsers(getUsers().map((u) => u.id === userId ? { ...u, name } : u));
  const s = getSession();
  if (s?.userId === userId) localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, name }));
}

export function deleteAccount(userId: string): void {
  const user = getUsers().find((u) => u.id === userId);
  putUsers(getUsers().filter((u) => u.id !== userId));
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(`essa_data_${userId}`);

  // Best-effort — local deletion above is what actually matters and is
  // already done. If this account ever synced, also try to remove that
  // backup rather than leaving it on the server indefinitely (see the
  // Privacy Policy's note on this). A failure here (offline, server down)
  // isn't surfaced — the user already got what "delete account" promises
  // locally; this is cleanup, not something to block or retry on.
  if (user) {
    import("./crypto").then(({ getSyncToken }) => {
      const token = getSyncToken();
      if (!token) return;
      import("./syncService").then(({ deleteFromServer }) => deleteFromServer(user.email, token));
    }).catch(() => {});
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
