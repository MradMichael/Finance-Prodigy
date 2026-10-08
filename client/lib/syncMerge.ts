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
  deletedKeySet, itemKeysByCollection, restoreGeneration, SETTING_KEYS, type SettingKey,
  type LocalFinancials, type PeriodClose, type TrackedBalance, type DeletedKeys, type Tombstone, type RevivedKeys, type MergeTransactionsResult,
} from "./localData";

import { stableStringify, tieBreak } from "./canonical";
import { fingerprint, settingValue, SETTING_FIELDS, type SeenMap, type SeenKind } from "./syncSeen";

export type { Tombstone } from "./localData";
export { stableStringify } from "./canonical";

const instant = (s: string | undefined) => (s ? new Date(s).getTime() : -Infinity);

/**
 * Union by key; the later `updatedAt` wins (absent sorts as older than any
 * edit); a key in `tombstones` is dropped whatever either copy says, unless
 * its record is a revival (a restore brought it back).
 */
export function mergeByKey<T extends { updatedAt?: string }>(
  local: T[], server: T[], keyOf: (t: T) => string, tombstones: Tombstone[] = [], revived?: Record<string, number>,
): T[] {
  const deleted = deletedKeySet(tombstones, revived);
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

/**
 * Which of two deletion records for one key stands: the later restore
 * generation; then the earlier time, as before -- which only picks the
 * record kept, never whether the key is deleted (revivals decide that, in
 * deletedKeySet and mergeTransactions). No clock decides anything.
 */
function outranks(t: Tombstone, seen: Tombstone): boolean {
  const gt = t.gen ?? 0, gs = seen.gen ?? 0;
  if (gt !== gs) return gt > gs;
  return t.deletedAt < seen.deletedAt;
}

/** Union by key; when both have one, the record that outranks stands. */
function mergeTombstones(a: Tombstone[] = [], b: Tombstone[] = []): Tombstone[] {
  const byKey = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    const seen = byKey.get(t.key);
    if (!seen || outranks(t, seen)) byKey.set(t.key, t);
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

/** Union of two revival maps; per key, the later generation. */
function mergeRevivedKeys(a: RevivedKeys | undefined, b: RevivedKeys | undefined): RevivedKeys | undefined {
  if (!a && !b) return undefined;
  const out: RevivedKeys = {};
  for (const k of DELETED_COLLECTIONS) {
    const merged: Record<string, number> = { ...(a?.[k] ?? {}) };
    for (const [key, gen] of Object.entries(b?.[k] ?? {})) merged[key] = Math.max(merged[key] ?? 0, gen);
    if (Object.keys(merged).length) out[k] = merged;
  }
  return out;
}

/**
 * Restoring an export file (Profile → import) after a reset (DI-13 follow-up,
 * owner, sessions 3-4): the restore must win, without clocks.
 *
 * The file's data replaces this device's, as before. The deletion records are
 * this device's and the file's together, untouched, so the reset's records
 * still hold for everything the file doesn't contain. EVERY live key the file
 * holds is revived at the next restore generation (revivedKeys), which beats
 * every deletion of that key made in an earlier generation on any device --
 * including one this device never synced. Soft-deleted transactions in an
 * older file aren't live, so they aren't revived.
 *
 * Cost: one entry per live item in the file (key and generation), kept like
 * the deletion records. Undo: resetting again records deletions at this
 * generation, and at the same generation a deletion beats a revival.
 */
export function restoreFromExport(current: LocalFinancials, file: LocalFinancials): LocalFinancials {
  const gen = Math.max(restoreGeneration(current), restoreGeneration(file)) + 1;
  const revivedKeys: RevivedKeys = mergeRevivedKeys(current.revivedKeys, file.revivedKeys) ?? {};
  const live = { ...file, transactions: (file.transactions ?? []).filter((t) => t.deletedAt == null && t.purgedAt == null) } as LocalFinancials;
  const restored = itemKeysByCollection(live);
  for (const c of DELETED_COLLECTIONS) {
    if (!restored[c].length) continue;
    revivedKeys[c] = { ...(revivedKeys[c] ?? {}) };
    for (const key of restored[c]) revivedKeys[c]![key] = gen;
  }
  const deletedKeys = mergeDeletedKeys(current.deletedKeys, file.deletedKeys);
  return { ...file, ...(deletedKeys ? { deletedKeys } : {}), revivedKeys };
}

/**
 * Tracked balances: the later check-in wins. A check-in (and a close) moves
 * `startingAt`, the baseline instant, so the copy with the later one holds
 * the newer observation. Equal baselines fall back to the later recorded
 * check (`actualBalanceDate`), then to the deterministic tie-break.
 */
function mergeTrackedBalances(local: TrackedBalance[], server: TrackedBalance[], tombstones: Tombstone[], revived?: Record<string, number>): TrackedBalance[] {
  const deleted = deletedKeySet(tombstones, revived);
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
  "transactions", "trackedBalances", "wishlist", "customCategories", "categoryRules", "periodCloses", "deletedKeys", "revivedKeys",
] as const satisfies readonly (keyof LocalFinancials)[];

/**
 * Plan H 5b: the fields the fingerprint rule also combines, when this device
 * has a record of its last sync. Without one they stay this device's copy.
 */
export const RULE_FIELDS = [
  "goals", "debts", "recurring", "assets", "settingsUpdatedAt",
  "income", "lbpRate", "lbpRateUpdatedAt", "budgetRule", "budgetCustomNeeds", "budgetCustomWants", "budgetSplitHealedAt", "budgetSplitHealedFrom",
  "cycleStartDay", "cycleStartDayChangedAt", "emergencyFundTargetMonths",
  "incomeHistory", "lbpRateHistory", "budgetRuleHistory", "netWorthHistory",
] as const satisfies readonly (keyof LocalFinancials)[];

export interface MergeFinancialsResult {
  data: LocalFinancials;
  /** Plan H 5b: two-sided changes settled by edit time, for the notice. Empty without fingerprints. */
  clashes: MergeClash[];
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
function withoutDeleted(d: LocalFinancials, deleted: DeletedKeys | undefined, revived: RevivedKeys | undefined): LocalFinancials {
  if (!deleted) return d;
  const gone = (c: keyof DeletedKeys) => deletedKeySet(deleted[c], revived?.[c]);
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

/** A two-sided change the fingerprint rule settled by edit time (plan H 5b), for the notice to name. */
export type MergeClash =
  | { kind: "goal" | "debt" | "recurring" | "asset" | "wishlist" | "category" | "rule"; name: string }
  | { kind: "setting"; setting: SettingKey; kept: unknown; other: unknown };

/**
 * The fingerprint rule for one keyed list (plan H 5b). Per key: the same on
 * both sides -> that; only one side differs from what this device last saw on
 * the server -> that side, with no clock compared; both differ (or there is
 * no record of the last sync for that key) -> the later edit time, a tie to
 * the content tie-break, and the winner reported. A key on one side only is
 * kept (union). Deletions are filtered out before this runs.
 */
function mergeBySeen<T>(
  local: T[], server: T[], keyOf: (t: T) => string, seen: Record<string, string> | undefined, stampOf: (t: T) => string | undefined,
): { items: T[]; clashed: { winner: T; local: T; server: T }[] } {
  const serverBy = new Map(server.map((s) => [keyOf(s), s]));
  const localKeys = new Set(local.map(keyOf));
  const items: T[] = [];
  const clashed: { winner: T; local: T; server: T }[] = [];
  for (const l of local) {
    const k = keyOf(l);
    const s = serverBy.get(k);
    if (s === undefined) { items.push(l); continue; }
    const fl = fingerprint(l), fs = fingerprint(s);
    if (fl === fs) { items.push(l); continue; }
    const base = seen?.[k];
    if (base !== undefined && fl === base) { items.push(s); continue; } // only the server changed
    if (base !== undefined && fs === base) { items.push(l); continue; } // only this device changed
    const tl = instant(stampOf(l)), ts = instant(stampOf(s));
    const winner = tl !== ts ? (tl > ts ? l : s) : tieBreak(l, s);
    items.push(winner);
    clashed.push({ winner, local: l, server: s });
  }
  for (const s of server) if (!localKeys.has(keyOf(s))) items.push(s);
  return { items, clashed };
}

/** A setting's value as the notice names it. */
function settingShown(d: LocalFinancials, key: SettingKey): unknown {
  switch (key) {
    case "income": return d.income;
    case "lbpRate": return d.lbpRate;
    case "payday": return d.cycleStartDay ?? 1;
    case "efTarget": return d.emergencyFundTargetMonths;
    case "budget": return d.budgetRule === "custom"
      ? { rule: "custom", needs: d.budgetCustomNeeds, wants: d.budgetCustomWants }
      : { rule: d.budgetRule ?? "50-30-20" };
  }
}

/** The settings, each one key, under the same rule; edit times from settingsUpdatedAt. */
function mergeSettingsBySeen(local: LocalFinancials, server: LocalFinancials, seen: Record<string, string> | undefined) {
  const patch: Record<string, unknown> = {};
  const stamps: Partial<Record<SettingKey, string>> = { ...(local.settingsUpdatedAt ?? {}) };
  const clashes: MergeClash[] = [];
  for (const key of SETTING_KEYS) {
    const lv = settingValue(local, key), sv = settingValue(server, key);
    const fl = fingerprint(lv), fs = fingerprint(sv);
    let from: LocalFinancials = local;
    if (fl !== fs) {
      const base = seen?.[key];
      if (base !== undefined && fl === base) from = server;
      else if (base !== undefined && fs === base) from = local;
      else {
        const tl = instant(local.settingsUpdatedAt?.[key]), ts = instant(server.settingsUpdatedAt?.[key]);
        from = tl !== ts ? (tl > ts ? local : server) : (tieBreak(lv, sv) === lv ? local : server);
        const other = from === local ? server : local;
        // Named only when the two values a person sees differ: both devices
        // healing one split alike, or one rate stamped at two times, is no news.
        const kept = settingShown(from, key), was = settingShown(other, key);
        if (stableStringify(kept) !== stableStringify(was)) clashes.push({ kind: "setting", setting: key, kept, other: was });
      }
    }
    for (const f of SETTING_FIELDS[key]) patch[f] = from[f];
    const stamp = from.settingsUpdatedAt?.[key];
    if (stamp) stamps[key] = stamp; else delete stamps[key];
  }
  return { patch: patch as Partial<LocalFinancials>, settingsUpdatedAt: stamps, clashes };
}

const byYm = <T extends { ym: string }>(xs: T[]) => [...xs].sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));

/**
 * Plan H 5b: everything the fingerprint rule covers, merged under it. Only
 * called with a record of this device's last sync; without one (the first
 * merge after the update) the merge stays exactly today's.
 */
function mergeUnderRule(local: LocalFinancials, server: LocalFinancials, deletedKeys: DeletedKeys | undefined, revivedKeys: RevivedKeys | undefined, seen: SeenMap) {
  const clashes: MergeClash[] = [];
  const s = (k: SeenKind) => seen.kinds[k];
  const stamp = (t: { updatedAt?: string }) => t.updatedAt;
  const named = <T extends { name: string }>(kind: "goal" | "debt" | "recurring" | "asset" | "wishlist", r: { clashed: { winner: T }[] }) =>
    r.clashed.forEach((c) => clashes.push({ kind, name: c.winner.name }));
  const live = <T>(xs: T[] | undefined, keyOf: (t: T) => string, c: keyof DeletedKeys) => {
    const gone = deletedKeySet(deletedKeys?.[c], revivedKeys?.[c]);
    return (xs ?? []).filter((x) => !gone.has(keyOf(x)));
  };

  const goals = mergeBySeen(local.goals ?? [], server.goals ?? [], (g) => g.id, s("goals"), stamp);
  named("goal", goals);
  // achievedAt is stamped once and never cleared by a merge: the earliest stays.
  const achieved = new Map<string, string>();
  for (const g of [...(local.goals ?? []), ...(server.goals ?? [])]) {
    if (g.achievedAt && (!achieved.has(g.id) || g.achievedAt < achieved.get(g.id)!)) achieved.set(g.id, g.achievedAt);
  }
  const goalsOut = goals.items.map((g) => (achieved.has(g.id) ? { ...g, achievedAt: achieved.get(g.id) } : g));

  const debts = mergeBySeen(local.debts ?? [], server.debts ?? [], (d) => d.id, s("debts"), stamp); named("debt", debts);
  const recurring = mergeBySeen(local.recurring ?? [], server.recurring ?? [], (r) => r.id, s("recurring"), stamp); named("recurring", recurring);
  const assets = mergeBySeen(local.assets ?? [], server.assets ?? [], (a) => a.id, s("assets"), stamp); named("asset", assets);
  const wishlist = mergeBySeen(live(local.wishlist, (w) => w.id, "wishlist"), live(server.wishlist, (w) => w.id, "wishlist"), (w) => w.id, s("wishlist"), stamp); named("wishlist", wishlist);
  const categories = mergeBySeen(live(local.customCategories, (c) => c.value, "customCategories"), live(server.customCategories, (c) => c.value, "customCategories"), (c) => c.value, s("customCategories"), stamp);
  categories.clashed.forEach((c) => clashes.push({ kind: "category", name: c.winner.label }));
  const rules = mergeBySeen(live(local.categoryRules, (r) => r.id, "categoryRules"), live(server.categoryRules, (r) => r.id, "categoryRules"), (r) => r.id, s("categoryRules"), stamp);
  rules.clashed.forEach((c) => clashes.push({ kind: "rule", name: c.winner.keyword }));

  const settings = mergeSettingsBySeen(local, server, s("settings"));
  clashes.push(...settings.clashes);

  const at = (e: { at?: string }) => e.at;
  const hist = <T extends { ym: string; at?: string }>(l: T[] | undefined, sv: T[] | undefined, k: SeenKind) =>
    byYm(mergeBySeen(l ?? [], sv ?? [], (e) => e.ym, s(k), at).items);

  return {
    data: {
      ...settings.patch,
      // Always written: a kept value with no edit time must clear this device's, or
      // its stale time would ride along on the merged copy and win the next clash.
      settingsUpdatedAt: Object.keys(settings.settingsUpdatedAt).length ? settings.settingsUpdatedAt : undefined,
      goals: goalsOut, debts: debts.items, recurring: recurring.items, assets: assets.items,
      wishlist: wishlist.items, customCategories: categories.items, categoryRules: rules.items,
      incomeHistory: hist(local.incomeHistory, server.incomeHistory, "incomeHistory"),
      lbpRateHistory: hist(local.lbpRateHistory, server.lbpRateHistory, "lbpRateHistory"),
      budgetRuleHistory: hist(local.budgetRuleHistory, server.budgetRuleHistory, "budgetRuleHistory"),
      netWorthHistory: hist(local.netWorthHistory, server.netWorthHistory, "netWorthHistory"),
    } as Partial<LocalFinancials>,
    clashes,
  };
}

/**
 * `seen` (plan H 5b): this device's fingerprints of the server's copy at its
 * last sync. Given, the goals, debts, recurring items, assets, settings,
 * histories, wishlist, categories and rules merge under the fingerprint rule.
 * Absent (null or undefined: no sync recorded since the update), the merge is
 * exactly what it was before.
 */
export function mergeFinancials(localIn: LocalFinancials, serverIn: LocalFinancials, now: Date = new Date(), seen?: SeenMap | null): MergeFinancialsResult {
  const at = now.toISOString();
  const deletedKeys = mergeDeletedKeys(localIn.deletedKeys, serverIn.deletedKeys);
  const revivedKeys = mergeRevivedKeys(localIn.revivedKeys, serverIn.revivedKeys);
  const local = withoutDeleted(localIn, deletedKeys, revivedKeys);
  const server = withoutDeleted(serverIn, deletedKeys, revivedKeys);
  const { closes, replaced } = mergeCloses(local.periodCloses ?? [], server.periodCloses ?? [], at);
  const localU = applyMergedUndos(local, closes);
  const serverU = applyMergedUndos(server, closes);
  const transactions = mergeTransactions(localU.transactions ?? [], serverU.transactions ?? [], revivedKeys?.transactions);
  const liveLocally = new Set((local.periodCloses ?? []).filter((c) => !c.reopenedAt).map(closeKey));
  const ruled = seen ? mergeUnderRule(local, server, deletedKeys, revivedKeys, seen) : null;
  return {
    data: {
      ...local,
      transactions: transactions.transactions,
      trackedBalances: mergeTrackedBalances(localU.trackedBalances ?? [], serverU.trackedBalances ?? [], deletedKeys?.trackedBalances ?? [], revivedKeys?.trackedBalances),
      wishlist: mergeByKey(local.wishlist ?? [], server.wishlist ?? [], (w) => w.id, deletedKeys?.wishlist, revivedKeys?.wishlist),
      customCategories: mergeByKey(local.customCategories ?? [], server.customCategories ?? [], (c) => c.value, deletedKeys?.customCategories, revivedKeys?.customCategories),
      categoryRules: mergeByKey(local.categoryRules ?? [], server.categoryRules ?? [], (r) => r.id, deletedKeys?.categoryRules, revivedKeys?.categoryRules),
      periodCloses: closes,
      ...(deletedKeys ? { deletedKeys } : {}),
      ...(revivedKeys ? { revivedKeys } : {}),
      ...(ruled ? ruled.data : {}),
    },
    clashes: ruled?.clashes ?? [],
    transactions,
    localTransactions: localU.transactions,
    serverTransactions: serverU.transactions,
    supersededFromLocal: replaced.filter((r) => liveLocally.has(closeKey(r.superseded))),
  };
}
