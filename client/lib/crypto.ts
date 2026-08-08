"use client";

// AES-GCM 256-bit encryption for localStorage at-rest protection.
//
// The actual data-encryption key (DEK) is random, generated once per
// account, and never derived directly from the password. Instead it's
// "wrapped" (encrypted) twice — once under a key derived from the
// password, once under a key derived from a one-time recovery code —
// so either secret can unlock the same DEK. This is what makes account
// recovery possible: forgetting the password doesn't mean losing the
// key, as long as the recovery code was saved.
//
// Accounts created before this existed have no wrapped DEK yet; auth.ts
// migrates them on next sign-in by treating their original
// password-derived key as the DEK (see migrateLegacyEnvelope) — this
// changes nothing about how their existing encrypted data decrypts.

const KEY_STORE = "essa_ek_v1";
const TOKEN_STORE = "essa_st_v1";
const ALGO = { name: "AES-GCM", length: 256 } as const;
const PBKDF2_ITERATIONS = 120_000;

export type Envelope = { v: 1; iv: string; ct: string };

export function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
export function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** PBKDF2 key-encryption-key (KEK) — used only to wrap/unwrap the DEK, never to encrypt data directly. */
async function deriveKek(secret: string, salt: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    ALGO,
    true,
    ["encrypt", "decrypt"],
  );
}

async function wrapDek(dek: Uint8Array, kek: CryptoKey): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, dek as BufferSource);
  return { v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(buf)) };
}

/** Returns the unwrapped DEK, or null if the secret/envelope don't match (wrong code, tampered data, etc). */
async function unwrapDek(env: Envelope, kek: CryptoKey): Promise<Uint8Array | null> {
  try {
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv) as BufferSource }, kek, fromB64(env.ct) as BufferSource);
    return new Uint8Array(buf);
  } catch {
    return null; // AES-GCM auth tag mismatch — wrong key
  }
}

/** Readable recovery code, e.g. "K7QM-4XPZ-9RTL-2WJC". Not stored anywhere raw — only wrapped-DEK envelopes derived from it. */
export function generateRecoveryCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I — avoids transcription mistakes
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/** Strips everything but letters/digits and uppercases, so "k7qm 4xpz-9rtl2wjc" and "K7QM-4XPZ-9RTL-2WJC" derive the same key — a hand-retyped code shouldn't fail just because the dashes/spacing don't match exactly. */
function canonicalizeRecoveryCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export interface DekEnvelopes {
  wrappedPassword: Envelope;
  wrappedRecovery: Envelope;
  recoveryCode: string;
}

/** New account: generates a fresh random DEK and wraps it under the password and a new recovery code. */
export async function createEnvelopes(password: string, userId: string): Promise<DekEnvelopes & { dek: Uint8Array }> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  return { dek, ...(await rewrapEnvelopes(dek, password, userId)) };
}

/**
 * Legacy account (pre-dates recovery codes): treats its existing
 * password-derived key as the DEK, so already-encrypted data keeps
 * decrypting unchanged, then wraps that same DEK under the password and
 * a new recovery code going forward.
 */
export async function migrateLegacyEnvelope(password: string, userId: string): Promise<DekEnvelopes & { dek: Uint8Array }> {
  const legacyKek = await deriveKek(password, `essa-v1-${userId}`); // same salt the old deriveKey() used
  const raw = await crypto.subtle.exportKey("raw", legacyKek);
  const dek = new Uint8Array(raw);
  return { dek, ...(await rewrapEnvelopes(dek, password, userId)) };
}

/** Wraps an existing DEK under a (possibly new) password and a freshly-generated recovery code. Used for both initial creation and password-reset re-wrapping. */
export async function rewrapEnvelopes(dek: Uint8Array, password: string, userId: string): Promise<DekEnvelopes> {
  const recoveryCode = generateRecoveryCode();
  const [kekPassword, kekRecovery] = await Promise.all([
    deriveKek(password, `essa-kek-v1-${userId}`),
    deriveKek(canonicalizeRecoveryCode(recoveryCode), `essa-recovery-v1-${userId}`),
  ]);
  const [wrappedPassword, wrappedRecovery] = await Promise.all([wrapDek(dek, kekPassword), wrapDek(dek, kekRecovery)]);
  return { wrappedPassword, wrappedRecovery, recoveryCode };
}

/**
 * Re-wraps the CURRENT session's already-unlocked DEK under a freshly
 * generated recovery code, leaving the password-wrapped side untouched.
 * For a signed-in user who wants a new recovery code (lost the old one,
 * or just wants to rotate it) without a full password-reset flow — unlike
 * rewrapEnvelopes, this never needs the plaintext password at all, which
 * matters because a normal signed-in session never has it: only the
 * unlocked DEK lives in sessionStorage after sign-in, never the password
 * itself. The old recovery code (and the wrappedDekRecovery envelope it
 * unwraps) stops working the moment this replaces it.
 */
export async function rewrapRecoveryOnly(dek: Uint8Array, userId: string): Promise<{ wrappedRecovery: Envelope; recoveryCode: string }> {
  const recoveryCode = generateRecoveryCode();
  const kekRecovery = await deriveKek(canonicalizeRecoveryCode(recoveryCode), `essa-recovery-v1-${userId}`);
  const wrappedRecovery = await wrapDek(dek, kekRecovery);
  return { wrappedRecovery, recoveryCode };
}

/** Unwraps the DEK using the password. Returns null if the envelope doesn't match (shouldn't happen if the password was already verified against pwHash). */
export async function unwrapWithPassword(password: string, userId: string, wrapped: Envelope): Promise<Uint8Array | null> {
  const kek = await deriveKek(password, `essa-kek-v1-${userId}`);
  return unwrapDek(wrapped, kek);
}

/** Unwraps the DEK using a recovery code. Returns null if the code is wrong. */
export async function unwrapWithRecoveryCode(code: string, userId: string, wrapped: Envelope): Promise<Uint8Array | null> {
  const kek = await deriveKek(canonicalizeRecoveryCode(code), `essa-recovery-v1-${userId}`);
  return unwrapDek(wrapped, kek);
}

/** Activates a DEK as this session's active encryption key. Call after unwrapping it by whichever path. */
export function activateSessionKey(dek: Uint8Array): void {
  sessionStorage.setItem(KEY_STORE, toB64(dek));
}

/** Clears the session key — call on sign-out. */
export function clearEncryptionKey(): void {
  sessionStorage.removeItem(KEY_STORE);
}

/**
 * True only if a DEK is actually active in this tab's sessionStorage right
 * now. The signed-in Session record lives in localStorage (persists across
 * tabs/restarts) while the DEK deliberately lives in sessionStorage (cleared
 * on browser close, scoped per-tab) — callers that only check for a Session
 * and skip this can end up "signed in" with no key, which used to make
 * encryptJSON/decryptJSON silently fail open. Check both before touching data.
 */
export function hasActiveKey(): boolean {
  try { return sessionStorage.getItem(KEY_STORE) !== null; }
  catch { return false; }
}

/** The current session's active DEK, if one's unlocked, for callers (like rewrapRecoveryOnly) that need the raw key rather than just a yes/no check. */
export function getActiveDek(): Uint8Array | null {
  try {
    const b64 = sessionStorage.getItem(KEY_STORE);
    return b64 ? fromB64(b64) : null;
  } catch { return null; }
}

/**
 * For the legacy sign-in migration only: proves a candidate password is
 * genuinely correct by actually decrypting this account's stored data with
 * the DEK it would derive, rather than trusting the legacy djb2 checksum
 * alone (32-bit and unsalted — brute-forceable in well under a minute).
 * Returns true/false when there's stored data to check against, or null
 * when there isn't yet (a legacy account that's never saved anything) —
 * callers should fall back to the checksum only in that narrow null case,
 * since there's nothing real to cryptographically verify against.
 */
export async function verifyLegacyPassword(password: string, userId: string): Promise<boolean | null> {
  let raw: string | null;
  try { raw = localStorage.getItem(`essa_data_${userId}`); } catch { return null; }
  if (!raw) return null;
  let parsed: Partial<Envelope>;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (parsed.v !== 1 || !parsed.iv || !parsed.ct) return null; // unencrypted legacy data — nothing to verify against
  const legacyKek = await deriveKek(password, `essa-v1-${userId}`);
  const result = await unwrapDek(parsed as Envelope, legacyKek);
  return result !== null;
}

/**
 * Shared PBKDF2-derive-bits-then-base64 primitive behind both sync tokens
 * below — keeps the iteration count at a single source of truth
 * (PBKDF2_ITERATIONS) instead of a copy-pasted literal per token.
 *
 * NFC-normalizes the secret first: a password/recovery code containing an
 * accented letter or a "smart quote" can be delivered as different Unicode
 * byte sequences by different keyboards for what looks like the identical
 * string (e.g. iOS vs a desktop IME), which would otherwise derive a
 * different token per device and desync sync credentials that a user
 * would swear are the same password. Deliberately NOT applied to the local
 * password-hash/DEK-wrap derivations elsewhere in this file — those
 * protect data already encrypted under the un-normalized form for
 * existing accounts, and changing that retroactively needs a real
 * migration, not a one-line tweak.
 */
async function derivePbkdf2Token(secret: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return toB64(new Uint8Array(bits));
}

/**
 * Derives a bearer token proving knowledge of the account password, sent
 * to the sync API instead of the password itself. Uses a different salt
 * than the password KEK (deriveKek above) so the two secrets are
 * cryptographically independent even though both come from the same
 * password.
 */
async function deriveSyncToken(password: string, email: string): Promise<string> {
  return derivePbkdf2Token(password, `essa-sync-v1-${email.toLowerCase().trim()}`);
}

/** Call this immediately after a successful sign-in or sign-up. Returns the token (e.g. for a relink call after a password reset). */
export async function initSyncToken(password: string, email: string): Promise<string> {
  const token = await deriveSyncToken(password, email);
  sessionStorage.setItem(TOKEN_STORE, token);
  return token;
}

/**
 * Derives a second, independent proof-of-ownership token from the account's
 * recovery code, registered on the server alongside the password-derived
 * sync token (see /api/sync/relink). A password reset changes the sync
 * token but not this one's underlying secret in the way that matters: the
 * OLD recovery code is exactly what recoverAccount() already requires the
 * user to type in, so it can authorize swapping in the new sync token
 * without ever sending the password or recovery code itself to the server.
 */
export async function deriveRecoveryToken(recoveryCode: string, email: string): Promise<string> {
  return derivePbkdf2Token(canonicalizeRecoveryCode(recoveryCode), `essa-sync-recovery-v1-${email.toLowerCase().trim()}`);
}

/** Clears the session token — call on sign-out. */
export function clearSyncToken(): void {
  sessionStorage.removeItem(TOKEN_STORE);
}

/** Returns the cached sync token, or null if the user hasn't signed in this session. */
export function getSyncToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_STORE); } catch { return null; }
}

async function getKey(): Promise<CryptoKey | null> {
  try {
    const b64 = sessionStorage.getItem(KEY_STORE);
    if (!b64) return null;
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey("raw", raw, ALGO, false, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

/**
 * Encrypts a JSON string. Returns the envelope JSON string.
 * Throws if there's no active key rather than silently storing plaintext —
 * a missing key here means the caller skipped the hasActiveKey() check
 * (e.g. a stale session outliving its per-tab key) and is about to persist
 * data it can't actually protect. Callers should guard with hasActiveKey()
 * before ever reaching this point; this throw is the backstop.
 */
export async function encryptJSON(plaintext: string): Promise<string> {
  const key = await getKey();
  if (!key) throw new Error("ENCRYPTION_KEY_MISSING");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const env: Envelope = { v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(buf)) };
  return JSON.stringify(env);
}

/**
 * Decrypts an envelope JSON string. Falls back to returning the input
 * unchanged only when it's genuinely plain JSON (migration from unencrypted
 * storage) — that's the one legitimate fallback. If it IS an encrypted
 * envelope but there's no key, or the key doesn't actually decrypt it, this
 * throws instead of returning the raw envelope/garbage as if it were real
 * data: silently succeeding here used to make a stale session look like an
 * empty account, and a subsequent save would then overwrite the real
 * encrypted record with that empty state.
 */
export async function decryptJSON(input: string): Promise<string> {
  let parsed: Partial<Envelope>;
  try {
    parsed = JSON.parse(input);
  } catch {
    return input; // not valid JSON at all — let the caller's own parse surface the real problem
  }
  if (parsed.v !== 1 || !parsed.iv || !parsed.ct) return input; // plain JSON — legit unencrypted-migration case

  const key = await getKey();
  if (!key) throw new Error("ENCRYPTION_KEY_MISSING");

  try {
    const iv = fromB64(parsed.iv) as BufferSource;
    const ct = fromB64(parsed.ct) as BufferSource;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("DECRYPT_FAILED");
  }
}
