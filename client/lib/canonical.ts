/**
 * Content comparison shared by every sync merge (SYNC-1 step 2; transactions
 * since 2026-10-07). Its own module so localData's transaction engine and
 * syncMerge, which imports from localData, can both use it without importing
 * each other.
 */

/** Key-sorted JSON, so equal content compares equal whatever its key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/**
 * The deterministic tie-break for two copies whose edit times can't decide:
 * the larger canonical text wins, so both devices make the same pick
 * whichever one is merging.
 */
export function tieBreak<T>(a: T, b: T): T {
  const sa = stableStringify(a), sb = stableStringify(b);
  return sa >= sb ? a : b;
}
