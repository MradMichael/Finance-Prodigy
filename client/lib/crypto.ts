"use client";

// AES-GCM 256-bit encryption for localStorage at-rest protection.
// Key is derived from the user's password via PBKDF2 and cached in
// sessionStorage (cleared automatically when the browser tab closes).

const KEY_STORE = "essa_ek_v1";
const ALGO = { name: "AES-GCM", length: 256 } as const;

async function deriveKey(password: string, userId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(`essa-v1-${userId}`),
      iterations: 120_000,
      hash: "SHA-256",
    },
    keyMaterial,
    ALGO,
    true,
    ["encrypt", "decrypt"],
  );
}

/** Call this immediately after a successful sign-in or sign-up. */
export async function initEncryptionKey(password: string, userId: string): Promise<void> {
  const key = await deriveKey(password, userId);
  const raw = await crypto.subtle.exportKey("raw", key);
  sessionStorage.setItem(KEY_STORE, btoa(String.fromCharCode(...new Uint8Array(raw))));
}

/** Clears the session key — call on sign-out. */
export function clearEncryptionKey(): void {
  sessionStorage.removeItem(KEY_STORE);
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

type Envelope = { v: 1; iv: string; ct: string };

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
