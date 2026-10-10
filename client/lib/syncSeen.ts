// Plan H, part 5b (owner-approved, session 5): "changed since this device's
// last sync" is decided by content fingerprints.
//
// For every key the fingerprint rule merges -- a list item by its key, a
// setting by name, a history entry by its cycle -- this device keeps a short
// fingerprint of the record's canonical content AS THE SERVER HELD IT the
// last time this device synced (a successful pull or push). At the next
// merge, a side whose record still has that fingerprint did not change.
//
// Stored encrypted, OUTSIDE LocalFinancials, under its own key per account:
// it is never uploaded, never exported, and never merged. Deleting the
// account removes it.
import { stableStringify } from "./canonical";
import { SETTING_KEYS, type LocalFinancials, type SettingKey, type StoredTransaction } from "./localData";

/** The keyed parts of an account the rule merges. */
export const SEEN_KINDS = [
  "goals", "debts", "recurring", "assets", "wishlist", "customCategories", "categoryRules",
  "settings", "incomeHistory", "lbpRateHistory", "budgetRuleHistory", "netWorthHistory",
  // Item 7 (owner, session 8): every transaction, by id.
  "transactions",
] as const;
export type SeenKind = (typeof SEEN_KINDS)[number];

/** Per kind, key -> fingerprint of the record as the server last held it. */
export interface SeenMap { v: 1; kinds: Partial<Record<SeenKind, Record<string, string>>> }

/** The fields each setting consists of; one setting is one key. */
export const SETTING_FIELDS: Record<SettingKey, readonly (keyof LocalFinancials)[]> = {
  income: ["income"],
  lbpRate: ["lbpRate", "lbpRateUpdatedAt"],
  budget: ["budgetRule", "budgetCustomNeeds", "budgetCustomWants", "budgetSplitHealedAt", "budgetSplitHealedFrom"],
  payday: ["cycleStartDay", "cycleStartDayChangedAt"],
  efTarget: ["emergencyFundTargetMonths"],
};

/**
 * Item 7 (owner, session 8): fields only a migration adds to existing
 * transactions (addCurrencyAndRate's lbpRateAtEntry, addGoalOpenings'
 * goalAmount). Left out of a transaction's fingerprint, so a migration that
 * runs on one device first doesn't look like that device changing every row.
 * Both are also set when a row is entered, but never changed alone by a
 * person: an edit that changes them changes the amount or currency too.
 */
export const MIGRATION_ONLY_TX_FIELDS = ["lbpRateAtEntry", "goalAmount"] as const;
/** A transaction as its fingerprint sees it. */
export function transactionContent(t: StoredTransaction): Record<string, unknown> {
  const out: Record<string, unknown> = { ...t };
  for (const f of MIGRATION_ONLY_TX_FIELDS) delete out[f];
  return out;
}
/** A transaction's fingerprint, without the migration-only fields. */
export const transactionFingerprint = (t: StoredTransaction): string => fingerprint(transactionContent(t));

/** A setting's value, as one record (absent fields left out). */
export function settingValue(d: LocalFinancials, key: SettingKey): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of SETTING_FIELDS[key]) if (d[f] !== undefined) out[f] = d[f];
  return out;
}

/**
 * A fingerprint of a value's canonical content (key order ignored):
 * 64-bit FNV-1a over stableStringify, as 16 hex digits. It detects change;
 * it is not a security measure.
 */
export function fingerprint(value: unknown): string {
  const s = stableStringify(value);
  let h1 = 0x811c9dc5, h2 = 0x050c5d1f;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** Each kind's records by key. */
export function keyedRecords(d: LocalFinancials, kind: SeenKind): Map<string, unknown> {
  const byId = <T extends { id: string }>(xs: T[] | undefined) => new Map((xs ?? []).map((x) => [x.id, x as unknown]));
  const byYm = <T extends { ym: string }>(xs: T[] | undefined) => new Map((xs ?? []).map((x) => [x.ym, x as unknown]));
  switch (kind) {
    case "goals": return byId(d.goals);
    case "debts": return byId(d.debts);
    case "recurring": return byId(d.recurring);
    case "assets": return byId(d.assets);
    case "wishlist": return byId(d.wishlist);
    case "categoryRules": return byId(d.categoryRules);
    case "customCategories": return new Map((d.customCategories ?? []).map((c) => [c.value, c as unknown]));
    case "settings": return new Map(SETTING_KEYS.map((k) => [k, settingValue(d, k) as unknown]));
    case "incomeHistory": return byYm(d.incomeHistory);
    case "lbpRateHistory": return byYm(d.lbpRateHistory);
    case "budgetRuleHistory": return byYm(d.budgetRuleHistory);
    case "netWorthHistory": return byYm(d.netWorthHistory);
    case "transactions": return new Map((d.transactions ?? []).map((t) => [t.id, transactionContent(t) as unknown]));
  }
}

/** The fingerprints of everything the rule merges, as `d` holds it. */
export function seenOf(d: LocalFinancials): SeenMap {
  const kinds: SeenMap["kinds"] = {};
  for (const k of SEEN_KINDS) {
    const out: Record<string, string> = {};
    for (const [key, rec] of keyedRecords(d, k)) out[key] = fingerprint(rec);
    kinds[k] = out;
  }
  return { v: 1, kinds };
}

const seenKey = (userId: string) => `essa_seen_${userId}`;

// DI-15: a record that couldn't be written to storage (full, a private
// window's quota) is still this device's record while the page is open.
// Without it, every merge after it was a "first merge" and said what may
// differ again. Only a failed write puts a record here; the next written one
// takes it out. Fingerprints only, never data.
const unsaved = new Map<string, SeenMap>();

/** This device's fingerprints for the account, or null before its first sync since the update. */
export async function loadSeen(userId: string): Promise<SeenMap | null> {
  if (typeof window === "undefined") return null;
  const held = unsaved.get(userId);
  if (held) return held;
  const raw = localStorage.getItem(seenKey(userId));
  if (!raw) return null;
  try {
    const { decryptJSON } = await import("./crypto");
    const parsed = JSON.parse(await decryptJSON(raw)) as SeenMap;
    return parsed && parsed.v === 1 && parsed.kinds ? parsed : null;
  } catch {
    return null; // unreadable: behave as before the first sync (today's merge)
  }
}

/**
 * Records the server's copy as this device's last sync. Only once this device
 * HOLDS that copy or a merge of it: after a successful push of its own data,
 * or once a pulled or fetched copy is stored. A copy recorded but never
 * applied would make this device's older records look like fresh edits, and
 * the next merge would undo the other device's changes.
 */
export async function saveSeen(userId: string, serverCopy: LocalFinancials): Promise<void> {
  if (typeof window === "undefined") return;
  let seen: SeenMap;
  try {
    seen = seenOf(serverCopy);
  } catch {
    return; // not a copy the rule can read: nothing recorded, today's merge next time
  }
  try {
    const { encryptJSON } = await import("./crypto");
    localStorage.setItem(seenKey(userId), await encryptJSON(JSON.stringify(seen)));
    unsaved.delete(userId);
  } catch {
    // Not written (DI-15): held for this page instead, and the stored record,
    // now stale, is dropped so it can't be read in its place after a reload.
    // That reload's next merge is then a first merge, once.
    unsaved.set(userId, seen);
    try { localStorage.removeItem(seenKey(userId)); } catch { /* nothing to drop */ }
  }
}

/** Deleting the account removes it with everything else; DI-15 drops it when a merge couldn't be stored. */
export function clearSeen(userId: string): void {
  unsaved.delete(userId);
  if (typeof window !== "undefined") localStorage.removeItem(seenKey(userId));
}
