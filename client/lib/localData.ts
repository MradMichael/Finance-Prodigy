"use client";

export type Currency = "USD" | "LBP";
export type PaymentMethod = "cash" | "card" | "other";

export interface StoredCard {
  id: string;
  type: "Visa" | "Mastercard" | "Amex" | "Other";
  last4: string;
  label: string; // e.g. "Visa •••• 1234"
}

export interface StoredTransaction {
  id: string;
  amount: number;
  currency: Currency;
  // The USD/LBP rate in effect when this record was entered -- only ever
  // meaningful (set) when currency is "LBP"; USD needs no conversion, so
  // this stays undefined for a USD record. Captured once, never
  // recomputed: this is what makes "historical records retain the rate at
  // which they were entered" (docs/ROADMAP.md Phase 1) true even after the
  // global reference rate changes later. See buildRecurringPaymentLog and
  // withRate below for where this gets populated on new records, and
  // migrateFinancials for how it's backfilled on existing ones.
  lbpRateAtEntry?: number;
  // INCOME is a one-off/incidental receipt (a gift, a reimbursement) logged as
  // a dated transaction like any other -- distinct from the recurring salary
  // set in Setup. StoredRecurring.bucket deliberately stays NEEDS/WANTS/SAVINGS
  // only: recurring income already has its own home (the Setup income field).
  bucket: "NEEDS" | "WANTS" | "SAVINGS" | "INCOME";
  // Optional, finer-grained than bucket (e.g. "Groceries" vs. the Needs
  // bucket it rolls up into) -- purely descriptive/for charting, never fed
  // into budget/EF/rollover/projection math, so it's safe to leave unset on
  // old entries or skip entirely. A built-in CategoryKey or a user-created
  // customCategories value -- plain string (not CategoryKey) because the
  // latter is only known at runtime, per account.
  category?: string;
  description: string;
  date: string; // YYYY-MM-DD
  paymentMethod?: PaymentMethod;
  paymentNote?: string; // for "other": who paid / context (e.g. "Dad filled gas tank")
  cardId?: string;
  cardLabel?: string;
}

export interface StoredGoal {
  id: string;
  name: string;
  emoji: string;
  targetAmount: number;
  currentAmount: number;
  // Added in schema v2 (docs/ROADMAP.md Phase 1.2) -- every goal before
  // this defaulted to USD implicitly (the only currency goals ever
  // supported), so migrateFinancials backfills "USD" rather than leaving
  // this optional. See localData.ts's StoredTransaction.currency comment
  // for why lbpRateAtEntry is optional even though currency isn't.
  currency: Currency;
  lbpRateAtEntry?: number;
  targetDate: string;   // YYYY-MM-DD
  createdAt: string;    // ISO — when added to ESSA
  achievedAt?: string;  // ISO — when goal was completed
  pausedAt?: string;    // ISO — when goal was paused/archived; stops counting toward pace/score until resumed (cleared)
}

export interface WishlistItem {
  id: string;
  name: string;
  emoji: string;
  price: number;
  currency: Currency;
  lbpRateAtEntry?: number;
  priority: "low" | "medium" | "high";
  notes?: string;
  createdAt: string;  // ISO — when added
  boughtAt?: string;  // ISO — when checked off as bought
}

/**
 * Reconciliation between what the app thinks you have (starting balance
 * minus every logged transaction on this payment method) and what you
 * actually see when you check your wallet/bank — a mismatch usually
 * means a payment never got logged. Only sees transactions, so debt
 * payments and un-"extra"'d recurring charges won't show up in the
 * expected figure — a known gap, not a bug.
 */
export interface TrackedBalance {
  id: string;
  name: string;             // "Cash", "Chase Checking"…
  paymentMethod: PaymentMethod;
  cardId?: string;          // set when paymentMethod === "card" — which saved card this tracks
  startingBalance: number;
  startingDate: string;     // YYYY-MM-DD
  currency: Currency;
  // Rate at startingDate only. A TrackedBalance actually has TWO
  // independent points in time that could each want their own rate --
  // this one, and whatever rate was in effect when actualBalance was
  // later confirmed -- but there's only one field. Known, deliberate
  // limitation for schema v2: nothing reads this yet (stop-safe), so it's
  // not a live correctness gap, just a modeling decision to revisit if a
  // later phase needs actualBalance's own rate specifically.
  lbpRateAtEntry?: number;
  actualBalance?: number;   // last balance you told it you actually have
  actualBalanceDate?: string; // ISO — when you last confirmed it
  // The live, computed "expected" total (USD) at the exact moment
  // actualBalance was confirmed -- captured directly rather than
  // reconstructed later from transaction dates, since a transaction only
  // stores a date (no time of day) and can't be reliably ordered against
  // an actualBalanceDate timestamp when both land on the same calendar
  // day. Falls back to the live expected total when absent (data from
  // before this field existed).
  expectedAtCheckUSD?: number;
}

export interface StoredAsset {
  id: string;
  name: string;      // e.g. "Car", "Brokerage account"
  value: number;
  currency: Currency;
  lbpRateAtEntry?: number;
  createdAt: string; // ISO
}

export interface StoredDebt {
  id: string;
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
  // Added in schema v2 -- see StoredGoal.currency's comment, same reasoning.
  currency: Currency;
  lbpRateAtEntry?: number;
  createdAt: string;     // ISO — when added to ESSA
  openedDate?: string;   // YYYY-MM-DD — when the debt was originally opened
  paidOffAt?: string;    // ISO — when balance reached 0
}

export type RecurringFrequency =
  | "weekly"       // ×4.333 /month
  | "biweekly"     // ×2.167 /month
  | "monthly"      // ×1 /month
  | "every2months" // ×0.5 /month
  | "quarterly"    // ×0.333 /month
  | "biannually"   // ×0.167 /month
  | "yearly";      // ×0.083 /month

export const FREQ_LABELS: Record<RecurringFrequency, string> = {
  weekly:       "Weekly",
  biweekly:     "Every 2 weeks",
  monthly:      "Monthly",
  every2months: "Every 2 months",
  quarterly:    "Quarterly",
  biannually:   "Every 6 months",
  yearly:       "Yearly",
};

export const FREQ_MONTHLY: Record<RecurringFrequency, number> = {
  weekly:       52 / 12,
  biweekly:     26 / 12,
  monthly:      1,
  every2months: 1 / 2,
  quarterly:    1 / 3,
  biannually:   1 / 6,
  yearly:       1 / 12,
};

export interface StoredRecurring {
  id: string;
  name: string;
  emoji: string;
  amount: number;
  currency: Currency;
  // Deliberately NEVER populated, unlike every other currency-bearing type
  // -- kept only for structural consistency across the monetary-record
  // types. A recurring item is an open-ended template, not a settled
  // event: every accrual is already, correctly, resolved at its OWN
  // accrual month via valueForMonth (computeDashboard.ts), and freezing a
  // rate at the template's startDate would be wrong the moment anything
  // read it as governing a later month. "The rate at which this was
  // entered" means something for the real, dated transactions this item
  // eventually produces (buildRecurringPaymentLog, InputPanel's "+extra"),
  // not for the template itself -- those get their own rate instead.
  lbpRateAtEntry?: number;
  frequency: RecurringFrequency;
  bucket: "NEEDS" | "WANTS" | "SAVINGS";
  // Same optional, display-only role as StoredTransaction.category (plain
  // string, not CategoryKey -- see that field's comment).
  category?: string;
  startDate: string;      // YYYY-MM-DD
  endDate: string | null; // null = infinite (unless totalAmount is set)
  totalAmount: number | null; // ends once this cumulative amount has been paid
  createdAt: string;      // ISO — when added to ESSA
  // YYYY-MM of the most recent cycle confirmed paid via a real logged
  // transaction (the "due" reminder's "Log payment" action) -- lets
  // monthlyEquivalent stop ALSO accruing its automatic pro-rated estimate
  // for that same month, so a confirmed payment doesn't count twice.
  lastPaidCycle?: string;
}

// Finer-grained than the NEEDS/WANTS/SAVINGS/INCOME bucket -- one flat list
// (not scoped per bucket) since a category like "Other" or "Gifts" can
// reasonably apply under more than one bucket, and a single list is far
// simpler to pick from and to chart than a bucket-conditional one.
export const CATEGORIES = [
  { value: "groceries",    label: "Groceries",         icon: "🛒" },
  { value: "rent",         label: "Rent / Mortgage",   icon: "🏠" },
  { value: "utilities",    label: "Utilities",         icon: "💡" },
  { value: "transport",    label: "Transport",         icon: "🚗" },
  { value: "dining",       label: "Dining out",        icon: "🍽️" },
  { value: "entertainment",label: "Entertainment",     icon: "🎬" },
  { value: "shopping",     label: "Shopping",          icon: "🛍️" },
  { value: "health",       label: "Health",            icon: "💊" },
  { value: "insurance",    label: "Insurance",         icon: "🛡️" },
  { value: "subscriptions",label: "Subscriptions",     icon: "🔁" },
  { value: "travel",       label: "Travel",            icon: "✈️" },
  { value: "education",    label: "Education",         icon: "📚" },
  { value: "gifts",        label: "Gifts & donations", icon: "🎁" },
  { value: "other",        label: "Other",             icon: "📦" },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]["value"];
export const CATEGORY_LABEL: Record<CategoryKey, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label]),
) as Record<CategoryKey, string>;
export const CATEGORY_ICON: Record<CategoryKey, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.icon]),
) as Record<CategoryKey, string>;

export interface CustomCategory { value: string; label: string; icon: string }

/** Built-in categories plus this account's user-created ones, in one combined
 * list -- feeds every category picker so a custom category shows up right
 * alongside the built-ins instead of a separate, easy-to-miss section. */
export function allCategories(customCategories?: CustomCategory[]): readonly { value: string; label: string; icon: string }[] {
  return customCategories && customCategories.length ? [...CATEGORIES, ...customCategories] : CATEGORIES;
}

/**
 * Label/icon for any category key -- built-in, custom, or an orphaned key
 * left on an old transaction/recurring item after its custom category was
 * deleted (falls back to the raw key/a generic icon rather than crashing).
 * "uncategorized" is the synthetic grouping key TransactionsScreen/
 * CategoriesScreen use for spend with no category set, not a real value.
 */
export function categoryLabel(key: string | undefined, customCategories?: CustomCategory[]): string {
  if (!key || key === "uncategorized") return "Uncategorized";
  return (CATEGORY_LABEL as Record<string, string>)[key] ?? customCategories?.find((c) => c.value === key)?.label ?? key;
}
export function categoryIcon(key: string | undefined, customCategories?: CustomCategory[]): string {
  if (!key || key === "uncategorized") return "❔";
  return (CATEGORY_ICON as Record<string, string>)[key] ?? customCategories?.find((c) => c.value === key)?.icon ?? "•";
}

export interface CategoryRule { id: string; keyword: string; category: string }

/**
 * Finds the first rule whose keyword appears in the description
 * (case-insensitive substring match, first-match-in-order wins), or
 * undefined if none match. Never decides on its own whether to override an
 * existing category -- "if null only" is enforced by callers (InputPanel's
 * commitTransaction, ImportStatement's row builder), which only call this
 * when the transaction/row doesn't already have a category, matching the
 * same principle as the "if null only" phrasing.
 */
export function matchCategoryRule(description: string, rules: CategoryRule[] | undefined): string | undefined {
  if (!rules || !description) return undefined;
  const lower = description.toLowerCase();
  return rules.find((r) => r.keyword.trim() && lower.includes(r.keyword.trim().toLowerCase()))?.category;
}

export type BudgetRuleKey = "40-30-30" | "50-30-20" | "60-20-20" | "70-20-10" | "80-15-5" | "custom";

export const BUDGET_RULES: Record<BudgetRuleKey, { label: string; desc: string; needs: number; wants: number; savings: number }> = {
  "40-30-30": { label: "40 / 30 / 30", desc: "Aggressive saver: maximize wealth",        needs: 40, wants: 30, savings: 30 },
  "50-30-20": { label: "50 / 30 / 20", desc: "Standard, balanced lifestyle",              needs: 50, wants: 30, savings: 20 },
  "60-20-20": { label: "60 / 20 / 20", desc: "Balanced, higher essential spending",       needs: 60, wants: 20, savings: 20 },
  "70-20-10": { label: "70 / 20 / 10", desc: "Tight budget, high-cost or lower income",  needs: 70, wants: 20, savings: 10 },
  "80-15-5":  { label: "80 / 15 / 5",  desc: "Survival: when every dollar counts",       needs: 80, wants: 15, savings: 5  },
  "custom":   { label: "Custom",       desc: "Set your own percentages",                   needs: 50, wants: 30, savings: 20 },
};

// Below this, a bucket reads as "not really part of the budget" rather than
// "a small share of it" -- and at exactly 0%, every downstream calculation
// that divides by or targets a percentage of this bucket breaks (an
// impossible "target <=0%", a 100%-over Budget card, an inflated Savings
// target absorbing the difference). No preset BUDGET_RULES value goes below
// this (the lowest is 5, in "80-15-5"'s savings), so flooring here never
// perturbs a non-custom rule -- only ever the user-editable custom split.
export const MIN_SPLIT_PCT = 5;

/** Clamps a custom Needs/Wants split so neither can squeeze the other below
 * MIN_SPLIT_PCT (Needs floored first, Wants floored against the now-floored
 * Needs) -- the single source of truth for this invariant, applied both to
 * live input (BudgetScreen's slider heal) and to every computed/historized
 * read of the split (computeDashboard.ts), so a bad stored value can't leak
 * into any screen the user happens to open first. */
export function floorCustomSplit(needs: number, wants: number): { needs: number; wants: number; savings: number } {
  const flooredNeeds = Math.max(MIN_SPLIT_PCT, Math.min(needs, 100 - MIN_SPLIT_PCT));
  const flooredWants = Math.max(MIN_SPLIT_PCT, Math.min(wants, 100 - MIN_SPLIT_PCT - flooredNeeds));
  return { needs: flooredNeeds, wants: flooredWants, savings: 100 - flooredNeeds - flooredWants };
}

export interface LocalFinancials {
  // Required, not optional -- the migration harness (migrateFinancials,
  // below) guarantees this is always present on anything that's passed
  // through loadData/saveData, so a call site that somehow bypasses both
  // and hands back raw, unmigrated data fails a real type check instead
  // of silently compiling. See docs/ROADMAP.md Phase 1.1.
  schemaVersion: number;
  userName: string;
  income: number;
  lbpRate: number;
  emergencyFundTargetMonths: number;
  emergencyFundBalance: number;
  transactions: StoredTransaction[];
  goals: StoredGoal[];
  debts: StoredDebt[];
  recurring: StoredRecurring[];
  cards: StoredCard[];
  assets: StoredAsset[];
  trackedBalances: TrackedBalance[];
  /** One entry per calendar month (YYYY-MM), appended/updated as the dashboard is computed — powers the net worth trend chart. */
  netWorthHistory: { ym: string; value: number }[];
  /** One entry per calendar month (YYYY-MM) that `income` actually changed in — lets past months be judged against what income was *then*, not whatever it is today. Absent/empty on accounts predating this field. */
  incomeHistory?: { ym: string; value: number }[];
  /** Same idea as incomeHistory, for `lbpRate` — LBP is volatile enough that using today's rate to re-convert a past month's LBP transactions silently rewrites history every time the rate is updated. */
  lbpRateHistory?: { ym: string; value: number }[];
  /** Same idea as incomeHistory/lbpRateHistory, for the resolved budget-rule percentages — otherwise switching budget rules silently rewrites what every past month "should have saved" (budgetRollover) and which past months count toward a savings streak. */
  budgetRuleHistory?: { ym: string; needs: number; wants: number; savings: number }[];
  /** ISO timestamp of the last time `lbpRate` was actually edited — powers the staleness indicator in SetupScreen (day-level precision; lbpRateHistory above only tracks month granularity). Absent on accounts predating this field, or if the rate has never been edited since. */
  lbpRateUpdatedAt?: string;
  budgetRule?: BudgetRuleKey;
  budgetCustomNeeds?: number;
  budgetCustomWants?: number;
  /** User-created categories, alongside the built-in CATEGORIES -- see allCategories/categoryLabel/categoryIcon. */
  customCategories?: CustomCategory[];
  /** Keyword -> category auto-assignment rules -- see matchCategoryRule. Only ever applied when a transaction/imported row has no category yet ("if null only"), never overriding a manual choice. */
  categoryRules?: CategoryRule[];
  wishlist?: WishlistItem[];
}

// Bumped whenever a stored-shape migration step is added to MIGRATIONS
// below. v2 (docs/ROADMAP.md Phase 1.2) adds currency to Goal/Debt and a
// captured lbpRateAtEntry to every LBP-currency record.
export const CURRENT_SCHEMA_VERSION = 2;

// The reference rate a new account starts with, and the fallback used
// anywhere financials.lbpRate is momentarily absent. Single source of
// truth -- see docs/ROADMAP.md Phase 1.3.
export const DEFAULT_LBP_RATE = 89500;

export const DEFAULT_DATA: LocalFinancials = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  userName: "You",
  income: 0,
  lbpRate: DEFAULT_LBP_RATE,
  emergencyFundTargetMonths: 6,
  emergencyFundBalance: 0,
  transactions: [],
  goals: [],
  debts: [],
  recurring: [],
  cards: [],
  assets: [],
  trackedBalances: [],
  customCategories: [],
  categoryRules: [],
  wishlist: [],
  netWorthHistory: [],
  incomeHistory: [],
  lbpRateHistory: [],
  budgetRuleHistory: [],
  budgetRule: "50-30-20",
};

/**
 * Ordered migration steps, each moving data from exactly `fromVersion` to
 * `fromVersion + 1`. migrateFinancials walks this in a single pass,
 * advancing one step whenever the data's current version exactly matches
 * a step's fromVersion -- which means the array must be a CONTIGUOUS chain
 * with no gaps, or a record several versions behind silently stops partway
 * through and gets stamped current anyway (see the 0->1 entry below).
 *
 * The 0->1 entry exists purely to close that gap. Phase 1.1 shipped with
 * this table empty -- harmless at the time, since CURRENT_SCHEMA_VERSION
 * was 1 and a v0 record just fell through to the unconditional final stamp
 * with nothing to apply. The gap became load-bearing the moment a real
 * fromVersion:1 step was going to be added for Phase 1.2's currency/rate
 * transform: every real account in production is v0 (no schemaVersion
 * field at all), so without this bridge, EVERY one of them would match
 * neither the (absent) v0 step nor the v1 step, fall through untouched,
 * and get silently stamped to the current version anyway -- the version
 * marker lying about a transform that never ran, permanently, with no
 * self-healing path once loadData's write-back (also Phase 1.2) persists
 * that wrong stamp to disk. Closing it now, on its own, independent of
 * Phase 1.2 itself, since it's a real defect in already-merged, already-
 * deployed code -- not something to leave latent until the next version
 * bump trips over it.
 */
/**
 * v1 -> v2 (Phase 1.2): currency + rate on every monetary record.
 * "App behaves identically, model is richer" (docs/ROADMAP.md) -- this
 * only adds and backfills fields; nothing anywhere reads them yet, so
 * this transform cannot change a single displayed number.
 *
 * Goals/debts had no currency at all before v2 -- every one that predates
 * this defaults to "USD" (every goal/debt this app has ever supported was
 * implicitly USD; the migration is additive, not interpretive, per the
 * roadmap's explicit instruction). Records that already have a value
 * (idempotency, or -- once 1.4 ships -- a genuinely non-USD goal/debt)
 * pass through via `??`, never overwritten.
 *
 * LBP-currency transactions/wishlist items/tracked balances/assets get
 * lbpRateAtEntry backfilled from the exact rate the app already,
 * effectively, uses for that record today -- valueForMonth over
 * lbpRateHistory, anchored on the record's own date, falling back to the
 * live lbpRate exactly like every existing call site does. This is
 * provably value-neutral: it captures what toUSDForMonth would already
 * compute, not a new number. Untouched if already present (idempotent),
 * and skipped entirely for USD records (rate-free by definition).
 *
 * Recurring items are deliberately excluded -- see StoredRecurring's own
 * lbpRateAtEntry comment for why a template shouldn't get one at all.
 */
function addCurrencyAndRate(d: LocalFinancials): LocalFinancials {
  const rateForDate = (dateOrIso: string) => valueForMonth(d.lbpRateHistory, dateOrIso.slice(0, 7), d.lbpRate);
  return {
    ...d,
    schemaVersion: 2,
    goals: d.goals.map((g) => ({ ...g, currency: (g as Partial<StoredGoal>).currency ?? "USD" })),
    debts: d.debts.map((deb) => ({ ...deb, currency: (deb as Partial<StoredDebt>).currency ?? "USD" })),
    transactions: d.transactions.map((t) =>
      t.currency === "LBP" && t.lbpRateAtEntry == null ? { ...t, lbpRateAtEntry: rateForDate(t.date) } : t,
    ),
    wishlist: (d.wishlist ?? []).map((w) =>
      w.currency === "LBP" && w.lbpRateAtEntry == null ? { ...w, lbpRateAtEntry: rateForDate(w.createdAt) } : w,
    ),
    trackedBalances: d.trackedBalances.map((tb) =>
      tb.currency === "LBP" && tb.lbpRateAtEntry == null ? { ...tb, lbpRateAtEntry: rateForDate(tb.startingDate) } : tb,
    ),
    assets: d.assets.map((a) =>
      a.currency === "LBP" && a.lbpRateAtEntry == null ? { ...a, lbpRateAtEntry: rateForDate(a.createdAt) } : a,
    ),
  };
}

const MIGRATIONS: { fromVersion: number; migrate: (d: LocalFinancials) => LocalFinancials }[] = [
  { fromVersion: 0, migrate: (d) => ({ ...d, schemaVersion: 1 }) },
  { fromVersion: 1, migrate: addCurrencyAndRate },
];

/** Reads the schema version off a raw, not-yet-migrated value -- treats a
 * missing/non-number version as 0, matching every real account in
 * production before schemaVersion existed. Shared by migrateFinancials
 * and loadData's write-back check (see below) so the two can't drift. */
export function schemaVersionOf(raw: unknown): number {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<LocalFinancials>;
  return typeof input.schemaVersion === "number" ? input.schemaVersion : 0;
}

/**
 * Turns whatever was actually in localStorage (or just pulled from the
 * server) into a complete, current-schema LocalFinancials. Called from
 * exactly two places -- loadData and saveData -- rather than from each
 * individual call site that reads or writes financial data, so a future
 * new call site inherits correct migration for free instead of needing
 * to remember to invoke this itself.
 *
 * Reads the version off the RAW input before any defaulting: merging
 * DEFAULT_DATA in first (which now itself carries CURRENT_SCHEMA_VERSION)
 * would make an old, unmigrated record indistinguishable from a genuinely
 * current one the instant the merge ran, defeating the whole point of the
 * marker.
 *
 * `migrations` defaults to the real MIGRATIONS table above; every
 * production call site relies on that default and never passes its own.
 * The parameter exists so a test can supply a synthetic multi-step chain
 * to verify the chain-walking mechanism itself (does a record several
 * versions behind actually receive every intermediate transform, not just
 * end up with the right-looking version number) -- see localData.test.ts.
 */
export function migrateFinancials(raw: unknown, migrations: typeof MIGRATIONS = MIGRATIONS): LocalFinancials {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<LocalFinancials>;
  const rawVersion = schemaVersionOf(raw);

  let data: LocalFinancials = { ...DEFAULT_DATA, ...input, schemaVersion: rawVersion };
  for (const step of migrations) {
    if (data.schemaVersion === step.fromVersion) data = step.migrate(data);
  }
  return { ...data, schemaVersion: CURRENT_SCHEMA_VERSION };
}

/** True when an account has literally nothing entered yet (fresh sign-up defaults) — used to gate the one-time auto-pull-on-first-load in app/page.tsx so it only ever fires for a genuinely blank local account, never silently overwriting real local data. */
export function isEmptyFinancials(data: LocalFinancials): boolean {
  // emergencyFundBalance, unlike income, is never replaced wholesale -- it's
  // nudged up and down by individual transactions (see InputPanel.tsx's
  // txAddToEF/txFromEF), so unlike a plain field it genuinely can accumulate
  // float drift over many edits and land on something like 1e-13 instead of
  // a clean 0. moneyEquals, not ===.
  return data.income === 0
    && moneyEquals(data.emergencyFundBalance, 0)
    && data.transactions.length === 0
    && data.goals.length === 0
    && data.debts.length === 0
    && data.recurring.length === 0
    && data.cards.length === 0
    && data.assets.length === 0
    && data.trackedBalances.length === 0;
}

/**
 * Looks up the value that was in effect for a given calendar month (YYYY-MM)
 * from a history array of {ym, value} snapshots — the most recent entry at
 * or before that month, or `fallback` if no history exists yet (accounts
 * created before history tracking existed, or a month before the first
 * recorded change). Shared by income and LBP-rate lookups since both are
 * "a flat current setting that can change over time" with the same shape.
 */
export function valueForMonth(
  history: { ym: string; value: number }[] | undefined,
  ym: string,
  fallback: number,
): number {
  if (!history || history.length === 0) return fallback;
  let best: { ym: string; value: number } | null = null;
  for (const h of history) {
    if (h.ym <= ym && (best === null || h.ym > best.ym)) best = h;
  }
  return best ? best.value : fallback;
}

/** Same lookup as valueForMonth, but for the {needs, wants, savings} shape budgetRuleHistory snapshots. */
export function budgetPctForMonth(
  history: { ym: string; needs: number; wants: number; savings: number }[] | undefined,
  ym: string,
  fallback: { needs: number; wants: number; savings: number },
): { needs: number; wants: number; savings: number } {
  if (!history || history.length === 0) return fallback;
  let best: { ym: string; needs: number; wants: number; savings: number } | null = null;
  for (const h of history) {
    if (h.ym <= ym && (best === null || h.ym > best.ym)) best = h;
  }
  // Floored even on a history hit -- a month snapshotted while the
  // pre-MIN_SPLIT_PCT bug was live could have recorded e.g. needs=0, and
  // that would otherwise keep leaking into rollover/streak math for that
  // month forever, regardless of the live split being fixed today.
  return best ? floorCustomSplit(best.needs, best.wants) : fallback;
}

function storageKey(userId: string) { return `essa_data_${userId}`; }

export async function loadData(userId: string): Promise<LocalFinancials> {
  if (typeof window === "undefined") return DEFAULT_DATA;
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return DEFAULT_DATA;

  const { decryptJSON } = await import("./crypto");
  let plain: string;
  try {
    plain = await decryptJSON(raw);
  } catch (err) {
    // decryptJSON throws ENCRYPTION_KEY_MISSING/DECRYPT_FAILED specifically
    // so a real encrypted record that can't be opened isn't mistaken for an
    // empty account — swallowing that here into DEFAULT_DATA would undo
    // exactly the fix that made it throw in the first place. Let it
    // propagate so the caller (gated on hasValidSession()) can tell the
    // difference and re-authenticate instead of silently showing empty data.
    if (err instanceof Error && (err.message === "ENCRYPTION_KEY_MISSING" || err.message === "DECRYPT_FAILED")) throw err;
    return DEFAULT_DATA; // genuinely corrupted/unparseable storage — fail safe
  }

  try {
    const parsed = JSON.parse(plain);
    const migrated = migrateFinancials(parsed);
    // Starting at schema v2 (Phase 1.2's real transform), a load that
    // migrates must also persist the result immediately, not defer to the
    // next natural save (docs/ROADMAP.md's explicit Phase 1.2 requirement).
    // Without this, what's on disk and what's about to render have
    // silently diverged the instant migration ran -- a crash, a closed
    // tab, or a pull from another device before the next edit would read
    // (or push) the stale, unmigrated bytes again.
    if (schemaVersionOf(parsed) !== CURRENT_SCHEMA_VERSION) {
      try {
        await saveData(migrated, userId);
      } catch {
        // Write-back failed (storage quota, an encryption hiccup) -- the
        // in-memory migrated data is still correct and safe to return.
        // Deliberately NOT the outer catch below: a persistence failure
        // here must never be treated as if the load itself failed, which
        // would discard a real, correctly-migrated account in favor of an
        // empty one. The next natural save (any edit) carries it to disk,
        // the same fallback Phase 1.1 always relied on.
      }
    }
    return migrated;
  } catch {
    return DEFAULT_DATA;
  }
}

export async function saveData(data: LocalFinancials, userId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const { encryptJSON } = await import("./crypto");
  // Migrated here too, not just in loadData -- this is what makes the four
  // call sites that consume a server pull directly (auth.ts signInFromSync/
  // recoverFromSync, page.tsx's auto-pull, profile.tsx's manual pull) safe
  // without touching any of them: whatever they hand in gets normalized to
  // the current schema on the way to disk, regardless of caller.
  const stored = await encryptJSON(JSON.stringify(migrateFinancials(data)));
  localStorage.setItem(storageKey(userId), stored);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Local calendar date, not UTC -- a bare new Date().toISOString() reads the
// UTC date, which disagrees with the user's own calendar for several hours
// out of every day (the exact window depends on their UTC offset). That
// mismatch is invisible most of the month but flips which calendar month
// "today" resolves to right around a month boundary -- e.g. a recurring
// item due August 1st reading as still active/due in July, or a
// just-logged transaction filed under the wrong month's "this month" list.
// computeDashboard.ts's own monthKey already uses local date parts; this
// matches it so every screen agrees on what "today" and "this month" mean.
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Converts an amount to USD given its own currency and the current LBP rate — was independently redefined as the same one-liner in computeDashboard.ts, InputPanel.tsx, RecurringScreen.tsx, and TransactionsScreen.tsx. */
export function toUSD(amount: number, currency: Currency | undefined, lbpRate: number): number {
  return currency === "LBP" ? amount / lbpRate : amount;
}

/**
 * lbpRateAtEntry for a NEW record being created right now, given its
 * currency and the current lbpRate -- USD needs no rate, so this returns
 * an empty object for it (spread into a new record's literal, exactly
 * like the existing `...(rec.category ? {category: rec.category} : {})`
 * pattern already used at several creation sites in InputPanel.tsx).
 * Every currency-picker creation site should use this rather than
 * inlining the currency === "LBP" check itself -- see docs/ROADMAP.md
 * Phase 1.2: a manual audit of every construction site missed three real
 * ones on the first pass, in a codebase with a documented habit of
 * parallel screen-level logic (GoalsScreen re-implementing InputPanel's
 * goal contribution, for one) -- a shared helper means a future
 * currency-aware site inherits correct rate capture for free.
 */
export function withRate(currency: Currency, lbpRate: number): { lbpRateAtEntry?: number } {
  return currency === "LBP" ? { lbpRateAtEntry: lbpRate } : {};
}

// ── Money precision (2026-08-17 audit follow-up, "Option B") ──────────────
// All money in this app is a native JS number (float dollars), not integer
// cents — see docs/AUDIT_2026-08.md, 2.4.16. That's a deliberate choice
// (no stored-data migration for a live app), not an oversight, but it means
// two things have to be true everywhere money is handled: round at the
// edges only, and never use exact equality on a value that came out of
// arithmetic. These two functions are the single, shared way to do both —
// duplicating either one locally anywhere is exactly the mistake this
// exists to prevent (see toUSD's own doc comment above for how that's
// already gone wrong once with a much simpler one-liner).

/**
 * Rounds to the nearest cent. Apply this at a *boundary* — formatting for
 * display, or the moment a computed value is written into stored/settled
 * data (an account's new balance, a total that gets persisted) — and
 * nowhere else. Rounding a value mid-calculation (e.g. every iteration of
 * a month-by-month simulation) doesn't fix float imprecision, it just
 * re-introduces a smaller, compounding version of it on every step instead
 * of once at the end; debtEngine.ts's own simulation loop is the concrete
 * example this matters for.
 */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Tolerance-based equality for a money value that came out of arithmetic
 * (a sum, a subtraction, a currency conversion) — floats accumulate
 * representation error (the textbook case: 0.1 + 0.2 !== 0.3), so a direct
 * === on a computed amount is a latent bug even when the two values are
 * "the same" in every sense that matters for currency. Not needed for a
 * raw, directly-stored field that's simply replaced wholesale on every
 * edit (e.g. the income figure the user types into Setup) — nothing has
 * ever done arithmetic on it, so it can't have drifted. It IS needed for
 * anything built from a sum, difference, or conversion, and especially
 * for anything that accumulates over many edits over time (an emergency
 * fund balance nudged up and down by many transactions, a debt balance
 * paid down over many months).
 *
 * Default epsilon is half a cent — tighter than roundMoney's own
 * cent-level rounding, so two values that are already both rounded and
 * genuinely equal always compare equal, while still absorbing ordinary
 * float dust from a chain of additions/subtractions.
 */
export function moneyEquals(a: number, b: number, epsilon = 0.005): boolean {
  return Math.abs(a - b) < epsilon;
}

/** Format an ISO date string (YYYY-MM-DD or full ISO) as DD/MM/YYYY for display. */
export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// Date-only strings ("YYYY-MM-DD") parse as UTC midnight per spec, but every
// caller of monthlyEquivalent/recurringPaidSoFar constructs `asOf` as LOCAL
// midnight (`new Date(y, m, 1)` or `new Date(\`${ym}-01T00:00:00\`)`). East of
// UTC (e.g. Beirut, UTC+3) that mismatch makes a recurring item's own start
// date compare as *later* than local midnight of that same calendar day, so
// its first month is silently skipped. Appending a local time-of-day makes
// the parse match how callers build `asOf`, everywhere both are meant to be
// compared as plain local dates. (nextOccurrence deliberately keeps the UTC
// parse -- it extracts UTC day/month/year from `start` for DST-safe
// month-increment arithmetic, not local comparison, so this fix doesn't apply there.)
function parseLocalDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/**
 * Whether this recurring item is currently active (started, not past its end
 * date, not exhausted by a totalAmount cap) as of the given date --
 * independent of whether THIS cycle's automatic accrual happens to be
 * suppressed because it was already logged as a real transaction (see
 * isPaidThisCycle). Conflating the two used to make a just-paid, still-very-
 * much-active subscription read as "ended" everywhere monthlyEquivalent hit
 * 0 for either reason (InputPanel's badge, RecurringScreen's totals,
 * printReport's PDF row) -- callers that care about "is this item over"
 * should use this, not `monthlyEquivalent(...) === 0`.
 */
export function isRecurringActive(r: StoredRecurring, asOf: Date = new Date()): boolean {
  const start = parseLocalDate(r.startDate);
  if (asOf < start) return false;

  // Exhausted by total amount: cumulative payments have hit the cap
  if (r.totalAmount != null && r.totalAmount > 0 && r.amount > 0) {
    const totalPeriods = r.totalAmount / r.amount;
    const totalMs = (totalPeriods / FREQ_MONTHLY[r.frequency]) * 30.4375 * 24 * 60 * 60 * 1000;
    if (asOf.getTime() > start.getTime() + totalMs) return false;
  }

  const end = r.endDate ? parseLocalDate(r.endDate) : null;
  if (end && asOf > end) return false;

  return true;
}

/** Whether this cycle's automatic pro-rated accrual is suppressed because a real transaction already covered it (lastPaidCycle) -- see monthlyEquivalent/isRecurringActive. */
export function isPaidThisCycle(r: StoredRecurring, asOf: Date = new Date()): boolean {
  if (!r.lastPaidCycle) return false;
  const asOfYm = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}`;
  return asOfYm === r.lastPaidCycle;
}

/** Monthly cost of a recurring item as of a given date, 0 if not currently active (isRecurringActive) OR if this cycle's accrual is already covered by a logged transaction (isPaidThisCycle) -- used for actual spend/budget math, where double-counting a paid cycle would be wrong. Displays that want a stable "what this costs" figure regardless of this cycle's payment status should use nominalMonthlyEquivalent instead. */
export function monthlyEquivalent(r: StoredRecurring, asOf: Date = new Date()): number {
  if (!isRecurringActive(r, asOf)) return 0;
  if (isPaidThisCycle(r, asOf)) return 0;
  return r.amount * FREQ_MONTHLY[r.frequency];
}

/** Same as monthlyEquivalent but ignores this-cycle payment suppression -- a recurring item's stable "what this costs" figure for display (RecurringScreen's totals, InputPanel's list, printReport's PDF), independent of whether this specific cycle has already been logged as a real transaction. Never use this for spend/budget totals -- see monthlyEquivalent. */
export function nominalMonthlyEquivalent(r: StoredRecurring, asOf: Date = new Date()): number {
  return isRecurringActive(r, asOf) ? r.amount * FREQ_MONTHLY[r.frequency] : 0;
}

const DAY_FREQ_LENGTH: Partial<Record<RecurringFrequency, number>> = { weekly: 7, biweekly: 14 };
const MONTH_FREQ_LENGTH: Partial<Record<RecurringFrequency, number>> = {
  monthly: 1, every2months: 2, quarterly: 3, biannually: 6, yearly: 12,
};

/** Next date this recurring item is due on/after `asOf`, or null if it's already ended (by end date or total-amount cap). */
export function nextOccurrence(r: StoredRecurring, asOf: Date = new Date()): Date | null {
  // Normalized to UTC midnight of asOf's own (local) calendar date --
  // "due on/after asOf" is a calendar-day question, not an exact-instant
  // one (start/end dates are themselves UTC-midnight-parsed, and callers
  // like Upcoming Renewals treat a match as "due today" for the whole
  // day). Comparing against the raw current instant instead made an
  // item's own due day read as already past — and skip ahead a full
  // period — as soon as any time had elapsed since UTC midnight, i.e.
  // almost immediately, on nearly every day it was actually due.
  const asOfDay = new Date(Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));
  const start = new Date(r.startDate);
  if (r.endDate && asOfDay > new Date(r.endDate)) return null;
  if (r.totalAmount != null && r.totalAmount > 0 && recurringPaidSoFar(r, asOfDay) >= r.totalAmount) return null;
  if (asOfDay <= start) return start;

  const dayLen = DAY_FREQ_LENGTH[r.frequency];
  if (dayLen != null) {
    const msPerPeriod = dayLen * 24 * 60 * 60 * 1000;
    // ceil, not floor+1 -- when asOfDay lands exactly on a period boundary
    // (due exactly today), floor+1 skips past it to the following period;
    // ceil correctly returns that boundary itself, matching "on/after".
    const periodsElapsed = Math.ceil((asOfDay.getTime() - start.getTime()) / msPerPeriod);
    return new Date(start.getTime() + periodsElapsed * msPerPeriod);
  }

  // Clamp to the target month's actual last day instead of letting
  // Date.setMonth overflow into the following month — a naive
  // next.setMonth(next.getMonth() + monthLen) on Jan 31 + 1 month lands on
  // March 3 (Feb only has 28/29 days), silently skipping a February
  // occurrence and shifting the recurring day going forward.
  const monthLen = MONTH_FREQ_LENGTH[r.frequency] ?? 1;
  const targetDay = start.getUTCDate();
  let next = new Date(start);
  // Strictly-less-than: stop as soon as `next` is on/after asOfDay and
  // return that value, instead of advancing past an exact match (the
  // same boundary bug as the day-frequency branch above, just as a loop).
  while (next < asOfDay) {
    const candidate = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + monthLen, 1));
    const daysInTargetMonth = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
    candidate.setUTCDate(Math.min(targetDay, daysInTargetMonth));
    next = candidate;
  }
  return next;
}

/** How much has been paid so far on a totalAmount-capped recurring item. */
export function recurringPaidSoFar(r: StoredRecurring, asOf: Date = new Date()): number {
  if (!r.totalAmount || r.amount <= 0) return 0;
  const start = parseLocalDate(r.startDate);
  if (asOf <= start) return 0;
  const monthsElapsed = (asOf.getTime() - start.getTime()) / (30.4375 * 24 * 60 * 60 * 1000);
  const periodsElapsed = Math.floor(monthsElapsed * FREQ_MONTHLY[r.frequency]);
  return Math.min(r.totalAmount, periodsElapsed * r.amount);
}

/**
 * Builds the real transaction and lastPaidCycle stamp for the "Log payment"
 * action (Overview's Renewing-soon list) -- both derived from the SAME
 * `due` value, so they can never disagree about which month they refer to.
 *
 * Previously the transaction was dated `now` (today, when clicked) while
 * the suppression stamp targeted `due`'s month (the cycle being paid). Those
 * agree only when `due` happens to fall in the same calendar month as the
 * click. The button is only ever shown within RENEWAL_WINDOW_DAYS (7 days)
 * of `due`, so for any item due on the 1st, the entire window in which the
 * button is clickable sits in the PRIOR month -- every legitimate use hit
 * the disagreement, not an edge case. The result was a same-month double
 * count (live estimate never suppressed, stacked with the new real
 * transaction) and a phantom next-month suppression (estimate, row, and
 * renewal reminder all silently zeroed with no transaction ever dated in
 * it). Dating the transaction to `due` instead of `now` closes both by
 * construction: whichever month `cycleYm` suppresses is exactly the month
 * the new transaction is dated in.
 *
 * `due` is already anchored at UTC midnight of a specific calendar day by
 * nextOccurrence's own construction, so slicing its ISO string is exact --
 * no local/UTC ambiguity to introduce here (unlike deriving a date from a
 * live "now" instant).
 *
 * `lbpRate` (Phase 1.2) is captured onto the created transaction via
 * withRate as its lbpRateAtEntry, if r.currency is LBP -- the CURRENT live
 * rate, not a historical lookup for due's month, since due can be a few
 * days in the future (paid early) and there's no historical rate for a
 * month that hasn't happened yet. "The rate at which this was entered"
 * means the rate at the moment of this real, settled action -- unlike the
 * recurring template itself, which never gets a rate at all (see
 * StoredRecurring's own comment).
 */
export function buildRecurringPaymentLog(r: StoredRecurring, lbpRate: number, now: Date = new Date()): { tx: StoredTransaction; cycleYm: string } | null {
  const due = nextOccurrence(r, now);
  if (!due) return null;
  const dueISO = due.toISOString().slice(0, 10);
  const cycleYm = dueISO.slice(0, 7);
  const tx: StoredTransaction = {
    id: uid(), amount: r.amount, currency: r.currency, bucket: r.bucket,
    ...(r.category ? { category: r.category } : {}),
    ...withRate(r.currency, lbpRate),
    description: r.name, date: dueISO, paymentMethod: "cash",
  };
  return { tx, cycleYm };
}

/**
 * Builds the transaction logged for a contribution toward a goal (Phase
 * 1.4) -- always in the GOAL's own currency, never USD by default. Two
 * independent call sites (GoalsScreen.pay, InputPanel.contributeToGoal)
 * used to each construct this transaction by hand, both hardcoding
 * `currency: "USD"` regardless of the goal's own currency -- exactly the
 * same class of duplicate-site drift that has already bitten this
 * codebase before (achievedAt, in these same two functions, earlier in
 * this project's history). Left unfixed once goals can be LBP, this would
 * silently mistag a real LBP contribution as USD, inflating that month's
 * savingsContrib/budget totals by roughly the LBP rate. Contributions are
 * NOT convertible to a different currency than the goal itself in this
 * phase -- see docs/ROADMAP.md Phase 1.4's own scope note.
 */
export function buildGoalContributionTx(goal: StoredGoal, amount: number, lbpRate: number): StoredTransaction {
  return {
    id: uid(), amount, currency: goal.currency, bucket: "SAVINGS",
    description: `Goal: ${goal.name}`, date: todayISO(), paymentMethod: "other",
    ...withRate(goal.currency, lbpRate),
  };
}
