/**
 * SEC-07 amended (owner, session 26, item 2; merged in session 28): a push or
 * pull refused for its credentials stops this device's automatic server
 * requests until the person signs in again here. Every refused request counts
 * toward the account's lock (server/src/lib/accountLimit.ts), so a device left
 * retrying with a password changed on another device would lock the account
 * for every device. Kept per account in localStorage, so a reload doesn't
 * retry. Only a sign-in or recovery the SERVER accepted clears it (lib/auth.ts;
 * owner, session 27): a local sign-in with the old password never does.
 */
const PREFIX = "essa_sync_refused_";

/** What the dashboard says while stopped (the owner's wording, session 27). */
export const SYNC_REFUSED_MESSAGE = "Backup has stopped on this device: the server didn't accept this device's password. If you changed your password on another device, sign in here with the new one. Your data on this device is safe."; // the owner's words (session 27)

export function isSyncRefused(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try { return localStorage.getItem(PREFIX + userId) !== null; } catch { return false; }
}

export function markSyncRefused(userId: string, now: Date = new Date()): void {
  try { localStorage.setItem(PREFIX + userId, now.toISOString()); } catch { /* the page still holds the stop until it's reloaded */ }
}

export function clearSyncRefused(userId: string): void {
  try { localStorage.removeItem(PREFIX + userId); } catch { /* nothing was kept */ }
}
