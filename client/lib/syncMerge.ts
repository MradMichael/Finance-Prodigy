/**
 * SYNC-1 step 2 (DI-08, 2026-10-06): merging two devices' copies of an
 * account, beyond transactions.
 *
 * Stage 1 reproduced the loss this exists to stop: the conflict merge kept the
 * merging device's copy of every field except transactions, so another
 * device's wishlist items, categories, rules, tracked-balance check-ins and
 * period closes were discarded with no notice.
 *
 * What merges, and by what rule (owner's decisions, 2026-10-06):
 *   * the wishlist (by id), custom categories (by value), category rules (by
 *     id): union, the later edit wins (`updatedAt`), a recorded deletion beats
 *     any copy (`deletedKeys`);
 *   * tracked balances (by id): when both devices checked in, the LATER
 *     check-in wins, judged by the baseline instant `startingAt`. That's Phase
 *     3's "never move a baseline backwards", applied across devices;
 *   * period closes (by cycle and closedAt): union. A reopen beats a live
 *     copy. Two live closes of one cycle: the earlier stands, and the later
 *     is superseded, undone the way a reopen undoes it, keeping its notes.
 * Transactions keep Phase 2.7's engine, which since 2026-10-07 compares content
 * and breaks ties with the same helpers (lib/canonical.ts). Everything else
 * (settings, goals, debts, recurring items, assets, cards, the histories)
 * keeps this device's copy, as before. The divergence notice names what
 * differed.
 *
 * Every rule is order-independent: which device is "local" never changes what
 * wins. Equal edit times with different content are broken by comparing the
 * two records' canonical text, the same way from both sides.
 */
import {
  mergeTransactions, undoCloseEffects, periodCloseKey, DELETED_COLLECTIONS,
  type LocalFinancials, type PeriodClose, type TrackedBalance, type DeletedKeys, type Tombstone, type MergeTransactionsResult,
} from "./localData";

import { stableStringify, tieBreak } from "./canonical";

export type { Tombstone } from "./localData";
export { stableStringify } from "./canonical";

const instant = (s: string | undefined) => (s ? new Date(s).getTime() : -Infinity);

/**
 * Union by key; the later `updatedAt` wins (absent sorts as older than any
 * edit); a key in `tombstones` is dropped whatever either copy says.
 */
export function mergeByKey<T extends { updatedAt?: string }>(
  local: T[], server: T[], keyOf: (t: T) => string, tombstones: Tombstone[] = [],
): T[] {
  const deleted = new Set(tombstones.map((t) => t.key));
  const serverByKey = new Map(server.map((s) => [keyOf(s), s]));
  const localKeys = new Set(local.map(keyOf));
  const out: T[] = [];
  for (const l of local) {
    const k = keyOf(l);
    if (deleted.has(k)) continue;
    const s = serverByKey.get(k);
    if (!s) { out.push(l); continue; }
    const tl = instant(l.updatedAt), ts = instant(s.updatedAt);
    out.push(tl !== ts ? (tl > ts ? l : s) : stableStringify(l) === stableStringify(s) ? l : tieBreak(l, s));
  }
  for (const s of server) {
    const k = keyOf(s);
    if (!localKeys.has(k) && !deleted.has(k)) out.push(s);
  }
  return out;
}

/** Union by key; when both have one, the earlier deletion time is kept. */
function mergeTombstones(a: Tombstone[] = [], b: Tombstone[] = []): Tombstone[] {
  const byKey = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    const seen = byKey.get(t.key);
    if (!seen || t.deletedAt < seen.deletedAt) byKey.set(t.key, t);
  }
  return [...byKey.values()];
}

function mergeDeletedKeys(a: DeletedKeys | undefined, b: DeletedKeys | undefined): DeletedKeys | undefined {
  if (!a && !b) return undefined;
  const out: DeletedKeys = {};
  for (const k of DELETED_COLLECTIONS) {
    const merged = mergeTombstones(a?.[k], b?.[k]);
    if (merged.length) out[k] = merged;
  }
  return out;
}

/**
 * Tracked balances: the later check-in wins. A check-in (and a close) moves
 * `startingAt`, the baseline instant, so the copy with the later one holds
 * the newer observation. Equal baselines fall back to the later recorded
 * check (`actualBalanceDate`), then to the deterministic tie-break.
 */
function mergeTrackedBalances(local: TrackedBalance[], server: TrackedBalance[], tombstones: Tombstone[]): TrackedBalance[] {
  const deleted = new Set(tombstones.map((t) => t.key));
  const serverById = new Map(server.map((s) => [s.id, s]));
  const localIds = new Set(local.map((l) => l.id));
  const pick = (a: TrackedBalance, b: TrackedBalance): TrackedBalance => {
    const sa = a.startingAt ?? "", sb = b.startingAt ?? "";
    if (sa !== sb) return sa > sb ? a : b;
    const ca = a.actualBalanceDate ?? "", cb = b.actualBalanceDate ?? "";
    if (ca !== cb) return ca > cb ? a : b;
    return stableStringify(a) === stableStringify(b) ? a : tieBreak(a, b);
  };
  const out: TrackedBalance[] = [];
  for (const l of local) {
    if (deleted.has(l.id)) continue;
    const s = serverById.get(l.id);
    out.push(s ? pick(l, s) : l);
  }
  for (const s of server) if (!localIds.has(s.id) && !deleted.has(s.id)) out.push(s);
  return out;
}

const closeKey = periodCloseKey;
const spanKey = (c: PeriodClose) => `${c.cycleKey}|${c.rangeStart}|${c.rangeEnd}`;
const earlier = (a: string | undefined, b: string | undefined) => (a && b ? (a < b ? a : b) : a ?? b);

export interface ReplacedClose { superseded: PeriodClose; standing: PeriodClose }

/**
 * Period closes, record by record. A close is append-only apart from its
 * tombstones, so the same record on both sides differs only in
 * `reopenedAt`/`supersededAt`, and the earlier of each is kept. Then two live
 * closes of one span: the earlier `closedAt` stands, the rest are superseded
 * at `at`, which also stamps `reopenedAt`.
 */
function mergeCloses(local: PeriodClose[], server: PeriodClose[], at: string): { closes: PeriodClose[]; replaced: ReplacedClose[] } {
  const serverByKey = new Map(server.map((s) => [closeKey(s), s]));
  const localKeys = new Set(local.map(closeKey));
  const combined: PeriodClose[] = [];
  for (const l of local) {
    const s = serverByKey.get(closeKey(l));
    if (!s) { combined.push(l); continue; }
    const { reopenedAt: _lr, supersededAt: _ls, ...lRest } = l;
    const { reopenedAt: _sr, supersededAt: _ss, ...sRest } = s;
    const body = stableStringify(lRest) === stableStringify(sRest) ? lRest : tieBreak(lRest, sRest);
    const reopenedAt = earlier(l.reopenedAt, s.reopenedAt);
    const supersededAt = earlier(l.supersededAt, s.supersededAt);
    combined.push({ ...body, ...(reopenedAt ? { reopenedAt } : {}), ...(supersededAt ? { supersededAt } : {}) } as PeriodClose);
  }
  for (const s of server) if (!localKeys.has(closeKey(s))) combined.push(s);

  const bySpan = new Map<string, PeriodClose[]>();
  for (const c of combined) {
    if (c.reopenedAt || c.supersededAt) continue;
    bySpan.set(spanKey(c), [...(bySpan.get(spanKey(c)) ?? []), c]);
  }
  const replaced: ReplacedClose[] = [];
  const supersede = new Map<string, PeriodClose>();
  for (const group of bySpan.values()) {
    if (group.length < 2) continue;
    const sorted = group.slice().sort((a, b) => (a.closedAt !== b.closedAt ? a.closedAt.localeCompare(b.closedAt) : stableStringify(a).localeCompare(stableStringify(b))));
    const standing = sorted[0];
    for (const later of sorted.slice(1)) {
      const marked = { ...later, supersededAt: at, reopenedAt: later.reopenedAt ?? at };
      supersede.set(closeKey(later), marked);
      replaced.push({ superseded: marked, standing });
    }
  }
  return { closes: combined.map((c) => supersede.get(closeKey(c)) ?? c), replaced };
}

/**
 * For one device's copy: undo every close the merge marked reopened or
 * superseded but that this copy still holds live, using the reopen rule
 * (undoCloseEffects). Later closes first, so each undo sees the state it
 * left. The stamp is the merged record's own `reopenedAt`, so both devices
 * produce the same rows.
 */
function applyMergedUndos(side: LocalFinancials, merged: PeriodClose[]): LocalFinancials {
  const liveHere = new Map((side.periodCloses ?? []).filter((c) => !c.reopenedAt).map((c) => [closeKey(c), c]));
  const undone = merged.filter((m) => m.reopenedAt && liveHere.has(closeKey(m))).sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  let d = side;
  for (const m of undone) d = undoCloseEffects(d, liveHere.get(closeKey(m))!, m.reopenedAt!);
  return d;
}

/** The fields mergeFinancials combines; every other field is this device's copy. */
export const MERGED_FIELDS = [
  "transactions", "trackedBalances", "wishlist", "customCategories", "categoryRules", "periodCloses", "deletedKeys",
] as const satisfies readonly (keyof LocalFinancials)[];

export interface MergeFinancialsResult {
  data: LocalFinancials;
  transactions: MergeTransactionsResult;
  /** Each side's transactions after the close undos, for naming what a conflict overrode. */
  localTransactions: LocalFinancials["transactions"];
  serverTransactions: LocalFinancials["transactions"];
  /** Closes that were live on THIS device and lost to another device's earlier close of the same cycle. */
  supersededFromLocal: ReplacedClose[];
}

/**
 * DI-13: drop from one side every transaction, close and item of the five
 * this-device lists whose key either device recorded as deleted. The
 * wishlist, categories, rules and tracked balances already drop theirs in
 * mergeByKey / mergeTrackedBalances.
 */
function withoutDeleted(d: LocalFinancials, deleted: DeletedKeys | undefined): LocalFinancials {
  if (!deleted) return d;
  const gone = (c: keyof DeletedKeys) => new Set((deleted[c] ?? []).map((t) => t.key));
  const tx = gone("transactions"), cl = gone("periodCloses");
  const keep = <T extends { id: string }>(list: T[] | undefined, set: Set<string>) => (list ?? []).filter((x) => !set.has(x.id));
  return {
    ...d,
    transactions: (d.transactions ?? []).filter((t) => !tx.has(t.id)),
    periodCloses: (d.periodCloses ?? []).filter((c) => !cl.has(closeKey(c))),
    goals: keep(d.goals, gone("goals")),
    debts: keep(d.debts, gone("debts")),
    recurring: keep(d.recurring, gone("recurring")),
    assets: keep(d.assets, gone("assets")),
    cards: keep(d.cards, gone("cards")),
  };
}

export function mergeFinancials(localIn: LocalFinancials, serverIn: LocalFinancials, now: Date = new Date()): MergeFinancialsResult {
  const at = now.toISOString();
  const deletedKeys = mergeDeletedKeys(localIn.deletedKeys, serverIn.deletedKeys);
  const local = withoutDeleted(localIn, deletedKeys);
  const server = withoutDeleted(serverIn, deletedKeys);
  const { closes, replaced } = mergeCloses(local.periodCloses ?? [], server.periodCloses ?? [], at);
  const localU = applyMergedUndos(local, closes);
  const serverU = applyMergedUndos(server, closes);
  const transactions = mergeTransactions(localU.transactions ?? [], serverU.transactions ?? []);
  const liveLocally = new Set((local.periodCloses ?? []).filter((c) => !c.reopenedAt).map(closeKey));
  return {
    data: {
      ...local,
      transactions: transactions.transactions,
      trackedBalances: mergeTrackedBalances(localU.trackedBalances ?? [], serverU.trackedBalances ?? [], deletedKeys?.trackedBalances ?? []),
      wishlist: mergeByKey(local.wishlist ?? [], server.wishlist ?? [], (w) => w.id, deletedKeys?.wishlist),
      customCategories: mergeByKey(local.customCategories ?? [], server.customCategories ?? [], (c) => c.value, deletedKeys?.customCategories),
      categoryRules: mergeByKey(local.categoryRules ?? [], server.categoryRules ?? [], (r) => r.id, deletedKeys?.categoryRules),
      periodCloses: closes,
      ...(deletedKeys ? { deletedKeys } : {}),
    },
    transactions,
    localTransactions: localU.transactions,
    serverTransactions: serverU.transactions,
    supersededFromLocal: replaced.filter((r) => liveLocally.has(closeKey(r.superseded))),
  };
}
