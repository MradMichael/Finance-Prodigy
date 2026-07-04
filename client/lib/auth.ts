"use client";

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
  return b64(new Uint8Array(bits)) === hashB64;
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

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!email.trim() || !name.trim() || !password) return { ok: false, error: "All fields are required." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  const users = getUsers();
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase().trim()))
    return { ok: false, error: "An account with this email already exists." };
  putUsers([...users, {
    id:        crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 18),
    email:     email.toLowerCase().trim(),
    name:      name.trim(),
    pwHash:    await hashPassword(password),
    createdAt: new Date().toISOString(),
    isAdmin:   users.length === 0, // first account registered is admin
  }]);
  return { ok: true };
}

export async function signIn(
  email: string, password: string,
): Promise<{ ok: true; session: Session } | { ok: false; error: string }> {
  const user = getUsers().find((u) => u.email === email.toLowerCase().trim());
  if (!user) return { ok: false, error: "No account found with this email." };

  let valid: boolean;
  if (user.pwHash.startsWith("pbkdf2:")) {
    valid = await verifyPassword(password, user.pwHash);
  } else {
    // Pre-existing account from before PBKDF2 hashing — verify against the
    // old hash, then silently upgrade so it's never checked that way again.
    valid = legacyHashPw(password) === user.pwHash;
    if (valid) {
      const upgraded = await hashPassword(password);
      putUsers(getUsers().map((u) => (u.id === user.id ? { ...u, pwHash: upgraded } : u)));
    }
  }
  if (!valid) return { ok: false, error: "Incorrect password." };

  const session: Session = { userId: user.id, email: user.email, name: user.name };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  const { initEncryptionKey, initSyncToken } = await import("./crypto");
  await initEncryptionKey(password, user.id);
  await initSyncToken(password, user.email);
  return { ok: true, session };
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null"); }
  catch { return null; }
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

export function updateProfile(userId: string, name: string): void {
  putUsers(getUsers().map((u) => u.id === userId ? { ...u, name } : u));
  const s = getSession();
  if (s?.userId === userId) localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, name }));
}

export function deleteAccount(userId: string): void {
  putUsers(getUsers().filter((u) => u.id !== userId));
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(`essa_data_${userId}`);
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
