import { createHash } from "crypto";

/**
 * SEC-07 (owner, session 25, item 4b; HELD): a per-account limit on wrong
 * credentials, with backoff. The sync limiter counts per client (IP); a
 * guesser spread across many addresses had no ceiling on one account.
 *
 * Five failures are free. From the sixth, each failure locks the account's
 * credential checks for 1, 2, 4, 8, then 15 minutes (the cap). While locked,
 * a request is refused before any comparison, the right credential too, so a
 * guess made during a lock learns nothing; such a request isn't counted. A
 * success clears the count, and a count is forgotten 24 hours after its last
 * failure.
 *
 * In memory, one per app (app.locals), keyed by a hash of the address, never
 * the address. One Render instance today, so one count; a restart clears it.
 * Bounded: past MAX_ACCOUNTS the longest-untouched entry is dropped.
 */
const FREE_FAILURES = 5;
const LOCK_MINUTES = [1, 2, 4, 8, 15];
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_ACCOUNTS = 10_000;

type Entry = { failures: number; lastFailureAt: number; lockedUntil: number };

export interface AccountLimit {
  /** Milliseconds left on this account's lock; 0 when it isn't locked. */
  lockedFor(email: string, now?: number): number;
  /** A wrong credential for this account. */
  fail(email: string, now?: number): void;
  /** A right one: the count starts again. */
  succeed(email: string): void;
  /** The hashed keys held (for tests: never an address). */
  keys(): IterableIterator<string>;
}

export function createAccountLimit(): AccountLimit {
  const entries = new Map<string, Entry>();
  const key = (email: string) => createHash("sha256").update("essa-account-limit:" + email).digest("hex");
  return {
    lockedFor(email, now = Date.now()) {
      const e = entries.get(key(email));
      return e && e.lockedUntil > now ? e.lockedUntil - now : 0;
    },
    fail(email, now = Date.now()) {
      const k = key(email);
      const prev = entries.get(k);
      const e = prev && now - prev.lastFailureAt <= FORGET_AFTER_MS ? prev : { failures: 0, lastFailureAt: now, lockedUntil: 0 };
      e.failures += 1;
      e.lastFailureAt = now;
      if (e.failures > FREE_FAILURES) {
        const step = Math.min(e.failures - FREE_FAILURES, LOCK_MINUTES.length) - 1;
        e.lockedUntil = now + LOCK_MINUTES[step] * 60_000;
      }
      entries.delete(k);
      entries.set(k, e); // most recently touched last
      if (entries.size > MAX_ACCOUNTS) entries.delete(entries.keys().next().value as string);
    },
    succeed(email) {
      entries.delete(key(email));
    },
    keys: () => entries.keys(),
  };
}

/** The sentence a locked account sees (DRAFT, held for the owner's approval). */
export function lockedSentence(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `Too many failed attempts for this account. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
