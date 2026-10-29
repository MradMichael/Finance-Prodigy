import { createHash } from "crypto";

/**
 * SEC-05 (owner, session 30, DECISIONS_PENDING entry 10 (a)): a limit on CREATING server copies,
 * per client address. A push to an address with no copy creates a row of up to 2 MB with no proof
 * of anything; from one client, 100 pushes per 15 minutes (the sync limiter) could create 200 MB
 * of rows under made-up addresses, and a Free Neon project holds 0.5 GB.
 *
 * At most PER_WINDOW new copies per client per WINDOW_MS, counted from each creation. A push to a
 * copy that exists isn't counted, so a person's own backups never meet it. A creation is reserved
 * before it's written and given back if it doesn't happen (a refusal, a failed write, or another
 * request creating the same row first), so only real creations count.
 *
 * The client is `req.ip`, the key the other limiters use (one trusted proxy, app.ts). In memory,
 * one per app (app.locals), keyed by a hash of the address, never the address; one Render instance
 * today, so one count; a restart clears it. Bounded: past MAX_CLIENTS the longest-untouched entry
 * is dropped.
 */
export const WINDOW_MS = 15 * 60 * 1000;
export const PER_WINDOW = 2;
const MAX_CLIENTS = 10_000;

/** The existing sentence (the auth and events limiters'), approved long before SEC-05. */
export const COPY_LIMIT_SENTENCE = "Too many requests. Please wait a few minutes and try again.";

export interface CopyCreationLimit {
  /** Reserves one creation for this client: its stamp, or null when the client's window is full. */
  reserve(client: string, now?: number): number | null;
  /** Gives back a reservation whose creation didn't happen. */
  release(client: string, stamp: number): void;
  /** The hashed keys held (for tests: never an address). */
  keys(): IterableIterator<string>;
}

export function createCopyCreationLimit(): CopyCreationLimit {
  const entries = new Map<string, number[]>();
  const key = (client: string) => createHash("sha256").update("essa-copy-limit:" + client).digest("hex");
  return {
    reserve(client, now = Date.now()) {
      const k = key(client);
      const live = (entries.get(k) ?? []).filter((t) => now - t < WINDOW_MS);
      entries.delete(k);
      if (live.length >= PER_WINDOW) { entries.set(k, live); return null; }
      live.push(now);
      entries.set(k, live); // most recently touched last
      if (entries.size > MAX_CLIENTS) entries.delete(entries.keys().next().value as string);
      return now;
    },
    release(client, stamp) {
      const live = entries.get(key(client));
      const i = live ? live.indexOf(stamp) : -1;
      if (live && i >= 0) live.splice(i, 1);
    },
    keys: () => entries.keys(),
  };
}
