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

function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function fromB64(s: string): Uint8Array {
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
    deriveKek(recoveryCode, `essa-recovery-v1-${userId}`),
  ]);
  const [wrappedPassword, wrappedRecovery] = await Promise.all([wrapDek(dek, kekPassword), wrapDek(dek, kekRecovery)]);
  return { wrappedPassword, wrappedRecovery, recoveryCode };
}

/** Unwraps the DEK using the password. Returns null if the envelope doesn't match (shouldn't happen if the password was already verified against pwHash). */
export async function unwrapWithPassword(password: string, userId: string, wrapped: Envelope): Promise<Uint8Array | null> {
  const kek = await deriveKek(password, `essa-kek-v1-${userId}`);
  return unwrapDek(wrapped, kek);
}

/** Unwraps the DEK using a recovery code. Returns null if the code is wrong. */
export async function unwrapWithRecoveryCode(code: string, userId: string, wrapped: Envelope): Promise<Uint8Array | null> {
  const kek = await deriveKek(code.trim().toUpperCase(), `essa-recovery-v1-${userId}`);
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
 * Derives a bearer token proving knowledge of the account password, sent
 * to the sync API instead of the password itself. Uses a different salt
 * than the password KEK (deriveKek above) so the two secrets are
 * cryptographically independent even though both come from the same
 * password.
 */
async function deriveSyncToken(password: string, email: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(`essa-sync-v1-${email.toLowerCase().trim()}`),
      iterations: 120_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

/** Call this immediately after a successful sign-in or sign-up. */
export async function initSyncToken(password: string, email: string): Promise<void> {
  const token = await deriveSyncToken(password, email);
  sessionStorage.setItem(TOKEN_STORE, token);
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

/** Encrypts a JSON string. Returns the envelope JSON string. */
export async function encryptJSON(plaintext: string): Promise<string> {
  const key = await getKey();
  if (!key) return plaintext; // no key yet — store as plain (will encrypt on next save)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const env: Envelope = {
    v: 1,
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(buf))),
  };
  return JSON.stringify(env);
}

/** Decrypts an envelope JSON string. Falls back to returning the input unchanged
 *  if the data is plain JSON (migration from unencrypted storage). */
export async function decryptJSON(input: string): Promise<string> {
  try {
    const parsed = JSON.parse(input) as Partial<Envelope>;
    if (parsed.v !== 1 || !parsed.iv || !parsed.ct) return input; // plain JSON — migrate
    const key = await getKey();
    if (!key) return input;
    const iv = Uint8Array.from(atob(parsed.iv), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(parsed.ct), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch {
    return input; // decrypt failed — return as-is so app can attempt JSON.parse
  }
}
