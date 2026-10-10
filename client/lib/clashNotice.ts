// Plan H 5d (owner, session 6): each change both devices made, said once on
// every device, the overridden one included.
//
// A merge that settles a clash records it in the synced copy
// (LocalFinancials.clashRecords, lib/syncMerge.ts). Whenever this device holds
// a copy, after a merge, a fetch, or on opening ESSA, it shows the records it
// hasn't shown before and remembers them. That memory is this device's only:
// encrypted under its own key per account, never uploaded or exported,
// removed with the account. A record is shown at most once per device unless
// the browser's storage is cleared. Records older than CLASH_RECORD_DAYS are
// not shown: they are on their way out of the copy. The memory forgets an id
// after twice that, by when no copy can still hold it.
import type { LocalFinancials } from "./localData";
import { CLASH_RECORD_DAYS, type ClashRecord } from "./syncMerge";

const DAY = 86_400_000;
const memoryKey = (userId: string) => `essa_clashes_shown_${userId}`;

/** id -> the record's `at`, for everything this device has shown. */
type Shown = Record<string, string>;

async function loadShown(userId: string): Promise<Shown> {
  const raw = localStorage.getItem(memoryKey(userId));
  if (!raw) return {};
  try {
    const { decryptJSON } = await import("./crypto");
    const parsed = JSON.parse(await decryptJSON(raw)) as { v: number; shown: Shown };
    return parsed?.v === 1 && parsed.shown ? parsed.shown : {};
  } catch {
    return {}; // unreadable: show what this copy holds rather than nothing
  }
}

async function saveShown(userId: string, shown: Shown): Promise<void> {
  try {
    const { encryptJSON } = await import("./crypto");
    localStorage.setItem(memoryKey(userId), await encryptJSON(JSON.stringify({ v: 1, shown })));
  } catch {
    // Not remembered: a record may be shown again on the next open. Nothing is lost.
  }
}

async function take(userId: string | undefined, data: LocalFinancials, now: Date, firstSync: boolean): Promise<ClashRecord[]> {
  if (!userId || typeof window === "undefined") return [];
  const cutoff = now.getTime() - CLASH_RECORD_DAYS * DAY;
  // Item 7: transactions' records live in their own field (older code's list stays theirs).
  const live = [...(data.clashRecords ?? []), ...(data.transactionClashRecords ?? [])].filter((r) => Date.parse(r.at) >= cutoff);
  if (live.length === 0) return [];
  const shown = await loadShown(userId);
  const fresh = live.filter((r) => !(r.id in shown))
    .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (fresh.length === 0) return [];
  for (const r of fresh) shown[r.id] = r.at;
  const forget = now.getTime() - 2 * CLASH_RECORD_DAYS * DAY;
  for (const [id, at] of Object.entries(shown)) if (Date.parse(at) < forget) delete shown[id];
  await saveShown(userId, shown);
  // Session 7 (owner): a device with no record of a last sync takes the records
  // already in its first pulled copy as shown. They are other devices' news
  // from before it joined (or before the update), not its own changes.
  return firstSync ? [] : fresh;
}

// One at a time: a fetch and the open can arrive together, and each record
// must be taken by exactly one of them.
let queue: Promise<unknown> = Promise.resolve();

/**
 * The records in `data` this device hasn't shown yet, oldest first, now
 * remembered as shown. The caller shows them (clashSentence). With
 * `firstSync` (this device had no record of a last sync before this copy),
 * they are remembered and none is returned.
 */
export function takeUnseenClashes(
  userId: string | undefined, data: LocalFinancials, now: Date = new Date(), { firstSync = false }: { firstSync?: boolean } = {},
): Promise<ClashRecord[]> {
  const next = queue.then(() => take(userId, data, now, firstSync));
  queue = next.catch(() => undefined);
  return next;
}
