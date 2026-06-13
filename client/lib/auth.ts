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

// Simple deterministic hash — good enough for a local demo.
// Replace with bcrypt / Argon2 server-side before any real deployment.
function hashPw(pw: string): string {
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

export function signUp(
  email: string, name: string, password: string,
): { ok: true } | { ok: false; error: string } {
  if (!email.trim() || !name.trim() || !password) return { ok: false, error: "All fields are required." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  const users = getUsers();
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase().trim()))
    return { ok: false, error: "An account with this email already exists." };
  putUsers([...users, {
    id:        crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 18),
    email:     email.toLowerCase().trim(),
    name:      name.trim(),
    pwHash:    hashPw(password),
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
  if (user.pwHash !== hashPw(password)) return { ok: false, error: "Incorrect password." };
  const session: Session = { userId: user.id, email: user.email, name: user.name };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  const { initEncryptionKey } = await import("./crypto");
  await initEncryptionKey(password, user.id);
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
    import("./crypto").then(({ clearEncryptionKey }) => clearEncryptionKey());
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
