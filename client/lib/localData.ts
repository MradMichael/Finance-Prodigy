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
  // Set only when this transaction was created by confirming a recurring
  // item's due cycle (Phase 2.5) -- links back to the StoredRecurring.id it
  // confirms. Absent for every other transaction (manual entries, goal
  // contributions, "+extra" recurring payments -- see
  // buildGoalContributionTx/InputPanel's logExtraPayment for why those stay
  // unlinked: they're additive, not a cycle's own settlement).
  recurringId?: string;
  // Which cycle this confirms -- the due date, not necessarily this
  // transaction's own `date` (2.4.30, finding A). `date` is the real
  // payment date (defaults to the due date, editable to record a late
  // payment correctly); `cycleDate` is fixed at confirm time and is what
  // isCycleConfirmed actually matches against, so cycle-tracking can't
  // drift just because a bill was paid a few days late. Only ever set
  // alongside recurringId. Absent (undefined) on transactions confirmed
  // before this field existed -- isCycleConfirmed falls back to `date` for
  // those. Explicit `null` is a distinct, later state (2.4.32, finding 4b):
  // the user deliberately detached this transaction from its cycle (e.g.
  // after editing `date` to a different month), and isCycleConfirmed must
  // NOT fall back to `date` in that case -- undefined means "never had one
  // to begin with," null means "had one, no longer does."
  cycleDate?: string | null;
  // Added in schema v4 (Phase 2.6.1) -- when this record was actually
  // ENTERED, separate from `date` ("when it happened"). Absent on every
  // transaction that predates this field, and never backfilled by
  // migration -- there's no real value to recover for a pre-existing
  // transaction, and stamping one with "today" would misrepresent when it
  // was actually entered. Only ever set going forward, at creation.
  createdAt?: string;
  // Added in schema v4 (Phase 2.6.1) -- soft-delete tombstone. "Delete
  // transaction" stamps this instead of removing the row; every normal
  // read (spend totals, lists, derived balances) is meant to filter
  // `deletedAt == null` once 2.6.3 wires that in. Absent means active.
  // Closes the "delete-and-redo is the only correction path, and it's
  // destructive" gap 2.4.27 found.
  deletedAt?: string;
  // Added in schema v4 (Phase 2.6.1) -- links this transaction to the
  // StoredDebt it paid down, for derivedDebtBalance (2.6.2). v1 keeps it
  // simple: the transaction's full `amount` applies to that one debt; a
  // payment split across multiple debts is two transactions, same pattern
  // already recommended for the dual-currency-single-transaction backlog
  // item (docs/ROADMAP.md).
  debtId?: string;
  // Added in schema v4 (Phase 2.6.1) -- signed: positive means this
  // transaction also added to the emergency fund, negative means it also
  // drew from it, for derivedEfBalance (2.6.2). Deliberately independent
  // of `amount`/`debtId` -- `|efAmount|` can be LESS than `amount`, which
  // is what makes "$300 of this $325 payment came from EF" representable
  // on one real transaction instead of forcing a choice (2.4.27's exact
  // bug).
  efAmount?: number;
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
  // Added in schema v4 (Phase 2.6.1) -- required, same reasoning as
  // `currency` above: once migrated (or created fresh), every debt has
  // one, so derivedDebtBalance (2.6.2) can read it without a fallback.
  // The real starting point derivedDebtBalance builds from: this value
  // minus every linked (debtId-matching) transaction since. Migration
  // snapshots the CURRENT `balance` into this, once, non-clobbering --
  // nothing retroactive, the balance a user already saw doesn't change.
  openingBalance: number;
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
  // Superseded by confirmCutoverDate/recurringId below (Phase 2.5) -- kept
  // on the type, unread by anything new, until 2.5.4 removes it once
  // nothing depends on it anymore.
  lastPaidCycle?: string;
  // Added in schema v3 (Phase 2.5, docs/ROADMAP.md) -- an ISO date, set
  // ONLY by the v2->v3 migration, only for recurring items that already
  // existed at migration time. Cycles due BEFORE this date are
  // grandfathered: settled without confirmation, never shown overdue, and
  // historical months before it keep computing spend the OLD (live
  // pro-rated estimate) way -- exactly like incomeHistory/lbpRateHistory
  // already judge a past month against what was true then, not today.
  // Cycles due ON OR AFTER it require an explicit confirmation (a real
  // StoredTransaction with recurringId === this item's id) or they read
  // OVERDUE. A recurring item created AFTER the account is already on
  // schema v3 never gets this field at all -- there's no history to
  // grandfather, so every one of its cycles needs confirmation from its
  // own startDate onward.
  confirmCutoverDate?: string;
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
  // Added in schema v4 (Phase 2.6.1) -- required, same reasoning as
  // StoredDebt.openingBalance above. The real starting point
  // derivedEfBalance (2.6.2) builds from: this value plus every
  // transaction's `efAmount` since. Migration snapshots the CURRENT
  // emergencyFundBalance into this, once, non-clobbering.
  emergencyFundOpeningBalance: number;
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
  /** Whether the one-time "recurring bills now count once you confirm them" notice has been dismissed (Phase 2.5.3). Optional, defaults falsy -- no migration needed, matches the existing "absent means not yet seen" pattern. */
  recurringModelNoticeSeen?: boolean;
}

// Bumped whenever a stored-shape migration step is added to MIGRATIONS
// below. v2 (docs/ROADMAP.md Phase 1.2) adds currency to Goal/Debt and a
// captured lbpRateAtEntry to every LBP-currency record. v3 (Phase 2.5.1)
// adds confirmCutoverDate to recurring items. v4 (Phase 2.6.1) adds
// emergencyFundOpeningBalance and StoredDebt.openingBalance.
export const CURRENT_SCHEMA_VERSION = 4;

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
  emergencyFundOpeningBalance: 0,
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

/**
 * v2 -> v3 (Phase 2.5, sub-phase 2.5.1 -- data model only, nothing reads
 * this yet). Stamps every EXISTING recurring item with confirmCutoverDate
 * = today (the device's own migration moment) -- grandfathering every
 * cycle due before today as settled, matching this migration's own
 * "app behaves identically, model is richer" bar. A recurring item added
 * AFTER this migration has already run (on an already-v3 account) never
 * gets this field at all, by construction -- addRecurring's own creation
 * path doesn't set it, only this migration does, and this migration only
 * ever runs once per record's lifetime (the non-clobber check below).
 * Nothing downstream reads confirmCutoverDate yet -- see StoredRecurring's
 * own doc comment for what it means once 2.5.3 does.
 *
 * Non-clobbering, same idiom as addCurrencyAndRate above: a record that
 * already has confirmCutoverDate (a second migration pass, or a device
 * that already migrated) passes through untouched, so re-running this is
 * a no-op -- required for double-migration idempotency.
 */
function addRecurringConfirmModel(d: LocalFinancials): LocalFinancials {
  const today = todayISO();
  return {
    ...d,
    schemaVersion: 3,
    recurring: d.recurring.map((r) => r.confirmCutoverDate ? r : { ...r, confirmCutoverDate: today }),
  };
}

/**
 * v3 -> v4 (Phase 2.6.1 -- data model only, nothing reads these yet).
 * Snapshots the current emergencyFundBalance and each debt's current
 * balance into new opening-balance fields -- the real starting point
 * sub-phase 2.6.2's derivation functions (derivedEfBalance/
 * derivedDebtBalance) will build from. Non-clobbering, same idiom as every
 * migration step above: a record that already has
 * emergencyFundOpeningBalance/a debt's openingBalance (a second migration
 * pass, or a device that already migrated) passes through untouched.
 *
 * StoredTransaction's new createdAt/deletedAt/debtId/efAmount fields need
 * NO migration action at all -- unlike an opening balance, there's no
 * historical value to snapshot for them (the app has never tracked which
 * past transaction represented a debt payment or an EF movement), so they
 * simply stay absent on every pre-existing transaction, exactly like
 * cycleDate stayed absent on transactions confirmed before IT existed.
 * They only ever get set going forward, once 2.6.3 wires the new
 * transaction-creation paths that populate them.
 */
function addLedgerDerivedFields(d: LocalFinancials): LocalFinancials {
  return {
    ...d,
    schemaVersion: 4,
    emergencyFundOpeningBalance: d.emergencyFundOpeningBalance ?? d.emergencyFundBalance,
    debts: d.debts.map((deb) => ({ ...deb, openingBalance: deb.openingBalance ?? deb.balance })),
  };
}

const MIGRATIONS: { fromVersion: number; migrate: (d: LocalFinancials) => LocalFinancials }[] = [
  { fromVersion: 0, migrate: (d) => ({ ...d, schemaVersion: 1 }) },
  { fromVersion: 1, migrate: addCurrencyAndRate },
  { fromVersion: 2, migrate: addRecurringConfirmModel },
  { fromVersion: 3, migrate: addLedgerDerivedFields },
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
 * Same reasoning applies to `emergencyFundOpeningBalance` (Phase 2.6.1) --
 * the first new field this chain has ever added directly on LocalFinancials
 * itself, rather than on a nested array element (StoredGoal.currency,
 * StoredRecurring.confirmCutoverDate). A nested element's own missing field
 * survives the DEFAULT_DATA merge below untouched (DEFAULT_DATA.debts is
 * `[]`, so the merge takes `input.debts` wholesale, never reaching inside
 * individual debt objects) -- but a TOP-LEVEL field doesn't: merging
 * DEFAULT_DATA.emergencyFundOpeningBalance (0, correct for a brand-new
 * account) in first would make a genuinely-old record that never had this
 * field indistinguishable from one that legitimately has a real opening
 * balance of exactly 0, defeating addLedgerDerivedFields' own non-clobber
 * check the exact same way an eager schemaVersion merge would defeat this
 * function's own version check. Read before defaulting, for the same reason.
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
  const rawEfOpening = input.emergencyFundOpeningBalance;

  let data: LocalFinancials = {
    ...DEFAULT_DATA, ...input, schemaVersion: rawVersion,
    emergencyFundOpeningBalance: rawEfOpening as number, // may be genuinely undefined here -- resolved below, by the end of this function, either via addLedgerDerivedFields or the final fallback
  };
  for (const step of migrations) {
    if (data.schemaVersion === step.fromVersion) data = step.migrate(data);
  }
  return {
    ...data, schemaVersion: CURRENT_SCHEMA_VERSION,
    // Safety net, not the primary mechanism: addLedgerDerivedFields already
    // resolves this for anything that actually walks through v3->v4. Only
    // matters for a malformed record that somehow claims >= v4 while still
    // missing the field -- shouldn't happen in practice, but the type
    // promises a real number, not undefined.
    emergencyFundOpeningBalance: data.emergencyFundOpeningBalance ?? data.emergencyFundBalance,
  };
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

/**
 * Whether a computed occurrence is actually real -- not past endDate, and
 * not beyond the totalAmount cap. `cycleIndex` is 0 for `start` itself, 1
 * for the occurrence one period after it, etc.; "payments up to and
 * including this one" is therefore cycleIndex + 1. Deliberately an EXACT
 * cycle count, not recurringPaidSoFar's elapsed-real-time approximation --
 * that approximation underestimates real cycle counts by a full period or
 * more even for a monthly item at short horizons (e.g. 500/mo, 60 real
 * days after start, 3 real cycles already occurred: it reports only 1).
 * Fine for its own actual purpose (InputPanel.tsx's "$X of $Y paid"
 * display, an approximate progress figure), wrong for deciding whether a
 * specific computed date is a real occurrence at all -- so this check
 * doesn't call it.
 */
function withinRecurringBounds(r: StoredRecurring, candidate: Date, cycleIndex: number): boolean {
  if (r.endDate && candidate > new Date(r.endDate)) return false;
  if (r.totalAmount != null && r.totalAmount > 0 && r.amount > 0 && (cycleIndex + 1) * r.amount > r.totalAmount) return false;
  return true;
}

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

  // Bounds are checked against the date each branch actually COMPUTES,
  // never against asOfDay (the query point) -- checking the query point
  // only asks "has the item already ended by the time I'm asking," not
  // "is the date I'm about to return still a real occurrence." Those agree
  // when the next real cycle is also before the boundary, and silently
  // disagree the moment it isn't: querying from just before an item's end
  // (or its total-amount cap) can still compute a candidate PAST it --
  // found while writing dueCycles' own tests (Phase 2.5.2), confirmed to
  // also affect upcomingRenewals live today, not just new code.
  if (asOfDay <= start) {
    return withinRecurringBounds(r, start, 0) ? start : null;
  }

  const dayLen = DAY_FREQ_LENGTH[r.frequency];
  if (dayLen != null) {
    const msPerPeriod = dayLen * 24 * 60 * 60 * 1000;
    // ceil, not floor+1 -- when asOfDay lands exactly on a period boundary
    // (due exactly today), floor+1 skips past it to the following period;
    // ceil correctly returns that boundary itself, matching "on/after".
    const periodsElapsed = Math.ceil((asOfDay.getTime() - start.getTime()) / msPerPeriod);
    const candidate = new Date(start.getTime() + periodsElapsed * msPerPeriod);
    return withinRecurringBounds(r, candidate, periodsElapsed) ? candidate : null;
  }

  // Clamp to the target month's actual last day instead of letting
  // Date.setMonth overflow into the following month — a naive
  // next.setMonth(next.getMonth() + monthLen) on Jan 31 + 1 month lands on
  // March 3 (Feb only has 28/29 days), silently skipping a February
  // occurrence and shifting the recurring day going forward.
  const monthLen = MONTH_FREQ_LENGTH[r.frequency] ?? 1;
  const targetDay = start.getUTCDate();
  let next = new Date(start);
  let cycleIndex = 0;
  // Strictly-less-than: stop as soon as `next` is on/after asOfDay and
  // return that value, instead of advancing past an exact match (the
  // same boundary bug as the day-frequency branch above, just as a loop).
  while (next < asOfDay) {
    const candidate = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + monthLen, 1));
    const daysInTargetMonth = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
    candidate.setUTCDate(Math.min(targetDay, daysInTargetMonth));
    next = candidate;
    cycleIndex++;
  }
  return withinRecurringBounds(r, next, cycleIndex) ? next : null;
}

/**
 * How much has been paid so far on a totalAmount-capped recurring item --
 * purely the sum of real, recurringId-linked confirmed transactions,
 * clamped at the cap. No grandfathered credit for pre-cutover cycles (2.4.31
 * fix, re-rated Launch Blocker 2026-08-25): a grandfathered cycle used to
 * count as paid on the strength of the migration's own "settled" assumption
 * alone, with zero StoredTransaction behind it -- confirmed live on the
 * owner's account, where an item with no real pre-migration history (data
 * collection started the same week as the migration) showed "$1,500 paid"
 * against exactly one real $750 transaction. `isCycleOverdue`'s grandfather
 * check is untouched -- it suppresses a different thing (alert flooding for
 * genuinely old history) and was never justified by the same reasoning this
 * function's old grandfathering was. See pendingBackfillCycles for how a
 * real, long-history item recovers an accurate figure: by explicit backfill
 * confirmation, not by assumption.
 *
 * Counts every confirmed transaction regardless of its own date (2.4.30) --
 * a cycle confirmed early (before its due date) is genuinely paid; excluding
 * it here understated "paid so far" for anyone who pays ahead, and worse,
 * let the SAME item's own cap check (nextConfirmTarget, below) miss real
 * confirmed amounts and keep offering cycles past what totalAmount actually
 * allows -- the same blind spot that let repeat confirms silently exceed
 * the cap.
 */
export function recurringPaidSoFar(r: StoredRecurring, transactions: StoredTransaction[]): number {
  if (!r.totalAmount || r.amount <= 0) return 0;
  // Phase 2.6.3b: a soft-deleted confirming transaction no longer counts --
  // same reasoning as isCycleConfirmed above.
  const confirmedSum = transactions
    .filter((t) => t.deletedAt == null && t.recurringId === r.id)
    .reduce((s, t) => s + t.amount, 0);
  return Math.min(r.totalAmount, confirmedSum);
}

/**
 * Pre-cutover cycles for a grandfathered, capped recurring item that have no
 * confirming transaction yet -- available to backfill (2.4.31 fix) rather
 * than assumed paid. Only meaningful for items with both a totalAmount cap
 * (recurringPaidSoFar's cap is the only thing a grandfathered cycle used to
 * distort) and a confirmCutoverDate (nothing to backfill for a v3-native
 * item, which never had grandfathering to begin with). Confirming one of
 * these via buildRecurringConfirmLog, dated to its own historical due date
 * (not today), is the deliberate, opt-in way a user with real pre-migration
 * history restores an accurate progress figure -- under-counting by default,
 * correct only through an explicit action, never the reverse.
 */
export function pendingBackfillCycles(r: StoredRecurring, transactions: StoredTransaction[]): Date[] {
  if (!r.confirmCutoverDate || !r.totalAmount) return [];
  const start = new Date(r.startDate);
  const cutover = new Date(r.confirmCutoverDate);
  const uncapped: StoredRecurring = { ...r, totalAmount: null };
  return dueCycles(uncapped, start, cutover)
    .filter((d) => d < cutover)
    .filter((d) => !isCycleConfirmed(r, d, transactions));
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
 * Every due date this recurring item has between `from` and `to`
 * (inclusive of both ends), for enumerating past cycles to check for
 * confirmation/overdue status (Phase 2.5) -- nextOccurrence only ever
 * answers "what's the next due date on/after asOf," never a full list, and
 * can't itself walk backward. Built by repeatedly calling nextOccurrence
 * and advancing past each result, rather than reimplementing its
 * day-length/month-length stepping logic a second time -- the two
 * functions are structurally incapable of disagreeing about what "the next
 * cycle after X" means, since only one of them actually computes it.
 * `to` is expected to be UTC-midnight-anchored, matching nextOccurrence's
 * own basis and every date this function returns.
 *
 * No longer needs to re-validate endDate/totalAmount itself -- it used to
 * (found while writing this function's own tests, Standing Rule 4:
 * nextOccurrence checked those bounds against the query point, not the
 * date it actually computed, so a call from just before an item's end
 * could still return a date past it). Fixed at the source in nextOccurrence
 * itself once found (see its own doc comment) -- it now returns null the
 * moment a computed candidate is out of bounds, which the `!next` check
 * below already handles.
 */
export function dueCycles(r: StoredRecurring, from: Date, to: Date): Date[] {
  const cycles: Date[] = [];
  let cursor = from;
  // Generous safety cap, not a realistic limit (a weekly item over 90+
  // years) -- each iteration strictly advances cursor past the cycle it
  // just recorded, so nextOccurrence's own determinism already guarantees
  // termination; this is just insurance against a future change to that
  // guarantee silently reintroducing an infinite loop here.
  for (let i = 0; i < 5000; i++) {
    const next = nextOccurrence(r, cursor);
    if (!next || next > to) break;
    cycles.push(next);
    cursor = new Date(next.getTime() + 24 * 60 * 60 * 1000);
  }
  return cycles;
}

/**
 * Whether a real, confirmed transaction exists for this exact cycle --
 * keyed by the cycle's own due DATE (YYYY-MM-DD), not its month. A weekly
 * or biweekly item can have several distinct due dates within the same
 * calendar month; keying by month would let confirming one silently also
 * "confirm" every other cycle sharing it, the same class of quiet
 * correctness gap this model exists to remove. `dueDate` is expected to be
 * the exact Date dueCycles/nextOccurrence produced for this cycle. Matches
 * `cycleDate` when present (2.4.30, finding A -- `date` is the real payment
 * date, which can differ from the cycle it confirms); falls back to `date`
 * for transactions confirmed before `cycleDate` existed, where `date` was
 * always the due date itself. Explicit `cycleDate: null` (2.4.32, finding
 * 4b) is a deliberate detach and never matches, even if `date` happens to
 * coincide with `dueDate` -- falling back to `date` here would make
 * detaching a no-op for the one case (date left unedited) it's most likely
 * used for.
 */
export function isCycleConfirmed(r: StoredRecurring, dueDate: Date, transactions: StoredTransaction[]): boolean {
  const dueISO = dueDate.toISOString().slice(0, 10);
  return transactions.some((t) => {
    // Phase 2.6.3b: a soft-deleted transaction never counts as confirming --
    // deleting it un-pays the cycle, with no special-case code needed
    // anywhere that calls this (isCycleOverdue, nextConfirmTarget,
    // pendingBackfillCycles all inherit this for free, since none of them
    // reads `transactions` any other way).
    if (t.deletedAt != null) return false;
    if (t.recurringId !== r.id) return false;
    if (t.cycleDate === null) return false;
    return (t.cycleDate ?? t.date) === dueISO;
  });
}

/**
 * Whether this specific cycle should read OVERDUE right now: due, not yet
 * confirmed, and not grandfathered by the item's own confirmCutoverDate
 * (see StoredRecurring's own comment). Never true for a cycle due before
 * the item's cutover, no matter how much time has passed -- that history is
 * settled, by design (docs/ROADMAP.md Phase 2.5's explicit backfill
 * decision). A cycle due exactly ON the cutover date is NOT grandfathered
 * -- only strictly-before is.
 *
 * `dueDate` and `asOf` must both be UTC-midnight-anchored calendar days
 * (nextOccurrence/dueCycles's own basis, and computeDashboard.ts's existing
 * `todayMidnight` pattern for "today") -- comparing against a raw `new
 * Date()` instant would make a cycle read overdue the moment its due day
 * begins rather than once the full day has passed.
 */
export function isCycleOverdue(r: StoredRecurring, dueDate: Date, asOf: Date, transactions: StoredTransaction[]): boolean {
  if (isCycleConfirmed(r, dueDate, transactions)) return false;
  if (dueDate >= asOf) return false; // not due yet, or due today -- not overdue until the day is over
  if (r.confirmCutoverDate && dueDate < new Date(r.confirmCutoverDate)) return false; // grandfathered
  return true;
}

/**
 * Builds the transaction for CONFIRMING a specific recurring cycle (Phase
 * 2.5) -- the new model's only path a recurring item ever becomes a real
 * StoredTransaction. Unlike buildRecurringPaymentLog, which always resolves
 * "whatever's next from now," this takes the exact cycle being confirmed
 * (from dueCycles), so it can confirm ANY outstanding cycle -- including an
 * old, overdue one, dated to when it was actually due, not to today. The
 * date-to-due-date behavior and re-entrancy risk this reuses are the same
 * as buildRecurringPaymentLog's own (2.4.21's actual fix); the one
 * addition is recurringId, which is what isCycleConfirmed later looks for.
 * `paidDate` (2.4.30, finding A) is the real payment date, defaulting to
 * `dueDate` -- `date` on the built transaction is always `paidDate`, so
 * every spend/budget/trend total reflects when the money actually moved;
 * `cycleDate` is always `dueDate`, so isCycleConfirmed can't lose track of
 * which cycle this is just because it was paid a few days late.
 */
export function buildRecurringConfirmLog(r: StoredRecurring, lbpRate: number, dueDate: Date, paidDate: Date = dueDate): { tx: StoredTransaction; cycleYm: string } {
  const dueISO = dueDate.toISOString().slice(0, 10);
  const paidISO = paidDate.toISOString().slice(0, 10);
  const cycleYm = dueISO.slice(0, 7);
  const tx: StoredTransaction = {
    id: uid(), amount: r.amount, currency: r.currency, bucket: r.bucket,
    ...(r.category ? { category: r.category } : {}),
    ...withRate(r.currency, lbpRate),
    description: r.name, date: paidISO, paymentMethod: "cash",
    recurringId: r.id, cycleDate: dueISO,
  };
  return { tx, cycleYm };
}

/**
 * The single shared target for every "confirm this recurring item" action
 * (Phase 2.5.3) -- Overview's chip, InputPanel's row, the FIFO backlog
 * count. Not `isRecurringActive`'s calendar-cycle-count cap: under
 * confirm-on-due, a cycle can sit unconfirmed indefinitely, so "calendar
 * cycles elapsed" and "amount actually paid" stop being the same question
 * (see `recurringPaidSoFar`'s own doc comment). `totalAmount` is stripped
 * before walking calendar cycles -- `dueCycles`/`nextOccurrence`'s own cap
 * would otherwise silently refuse to generate a candidate past the item's
 * Nth calendar slot, regardless of how many of those N were ever confirmed
 * -- and the real cap is enforced once, explicitly, up front instead,
 * against `recurringPaidSoFar`'s grandfathered+confirmed accounting.
 * `endDate` still bounds the walk; it's a real calendar fact, not a
 * payment-status question.
 *
 * The fallback branch below (2.4.30) must itself skip past any cycle
 * that's already confirmed EARLY -- before its own due date. `dueCycles`
 * (the overdue branch) can only ever return dates on/before `asOf`, so a
 * cycle confirmed ahead of schedule never enters that branch at all and
 * its confirmation is invisible to it; without this loop, nextOccurrence
 * just recomputes the same future date every time, forever, regardless of
 * how many times it's already been confirmed -- the exact mechanism that
 * produced 3 duplicate transactions from 3 ordinary clicks in live use.
 * A loop, not a single check: confirming several cycles ahead in a row
 * must skip past all of them, not just the first.
 */
export function nextConfirmTarget(r: StoredRecurring, transactions: StoredTransaction[], asOf: Date): { dueDate: Date; overdueCount: number } | null {
  if (r.totalAmount != null && r.totalAmount > 0 && recurringPaidSoFar(r, transactions) >= r.totalAmount) return null;
  const uncapped: StoredRecurring = r.totalAmount != null ? { ...r, totalAmount: null } : r;
  const from = new Date(r.confirmCutoverDate ?? r.startDate);
  const overdue = dueCycles(uncapped, from, asOf).filter((d) => isCycleOverdue(r, d, asOf, transactions));
  if (overdue.length > 0) return { dueDate: overdue[0], overdueCount: overdue.length }; // dueCycles is ascending -- FIFO falls out for free
  let next = nextOccurrence(uncapped, asOf);
  for (let i = 0; next && isCycleConfirmed(r, next, transactions) && i < 5000; i++) {
    next = nextOccurrence(uncapped, new Date(next.getTime() + 24 * 60 * 60 * 1000));
  }
  return next ? { dueDate: next, overdueCount: 0 } : null;
}

/**
 * The historized-value rule for recurring accrual (Phase 2.5.3) -- exactly
 * the same "what was true AS OF this month" treatment toUSDForMonth/
 * valueForMonth/budgetTargetPctForMonth already give every other setting,
 * applied to accrual: a month before this item's own cutover keeps the old
 * live-estimate accrual (unchanged from what a user already saw); a month
 * on/after it contributes nothing here, because a confirmed cycle is
 * already a real StoredTransaction, already summed by the ordinary
 * transaction loop wherever this is called -- adding it again here would
 * double-count it, and an unconfirmed cycle correctly contributes nothing
 * at all until it's confirmed.
 *
 * The no-`confirmCutoverDate` case (a recurring item created after the
 * account was already on schema v3) MUST fall into the new rule, not the
 * old one -- it has no history to grandfather, every cycle needs
 * confirmation from its own first month. `!r.confirmCutoverDate ||
 * ym < cutoverYm` would read as "no cutover -> always old rule," which is
 * backwards; the condition below is deliberately the other way around.
 */
export function historizedRecurringContribution(r: StoredRecurring, ym: string, asOf: Date): number {
  if (r.confirmCutoverDate && ym < r.confirmCutoverDate.slice(0, 7)) {
    return monthlyEquivalent(r, asOf);
  }
  return 0;
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

// ── Phase 2.6.2 -- ledger-derived EF/debt balances (pure logic, shipped
// completely unwired; see docs/ROADMAP.md Phase 2.6). No caller anywhere
// in the app uses these yet -- `emergencyFundBalance`/`debt.balance`
// remain the live, mutated fields until 2.6.3 flips every reader/writer
// over together, same discipline as 2.5.2's own pure functions shipping
// unwired before 2.5.3's flip. Proven correct in isolation now, against
// the owner's real 2.4.27 scenario, rather than debugged live while the
// flip is also in flight. ──────────────────────────────────────────────

/**
 * The emergency fund balance, derived instead of stored-and-mutated
 * (2.4.27/2.4.31's own root fix, applied to EF/debt): opening balance plus
 * every non-deleted transaction's `efAmount` since. Replaces
 * `emergencyFundBalance` once 2.6.3 wires this in -- until then, this
 * function has no callers.
 *
 * `efAmount` is always USD-terms, matching `emergencyFundBalance`/
 * `emergencyFundOpeningBalance`'s own currency-less, implicitly-USD
 * nature (neither has ever had a `currency` field, unlike goals/debts
 * since Phase 1.2) -- an LBP transaction's `efAmount` must already be
 * converted to USD by whatever sets it (2.6.3's transaction-creation
 * code), the same way `InputPanel.tsx`'s current `txAddToEF` computes
 * `amtUSD` before touching the old field. This function does no
 * conversion itself; it trusts the value it's given.
 *
 * Soft-deleted transactions (`deletedAt` set) are excluded -- exactly
 * what makes editing/deleting a transaction require no special reversal
 * logic anywhere once this is wired in: the derived balance just
 * recomputes fresh from whatever the transaction list now says.
 */
export function derivedEfBalance(data: LocalFinancials): number {
  const contributions = data.transactions
    .filter((t) => t.deletedAt == null && t.efAmount != null)
    .reduce((s, t) => s + (t.efAmount as number), 0);
  return roundMoney(data.emergencyFundOpeningBalance + contributions);
}

/**
 * A single debt's balance, derived instead of stored-and-mutated: opening
 * balance minus every non-deleted transaction whose `debtId` matches this
 * debt, summed by its own `amount`. Replaces `debt.balance` once 2.6.3
 * wires this in -- until then, this function has no callers.
 *
 * v1 keeps it simple, matching `docs/ROADMAP.md`'s own scope note: a
 * linked transaction's `amount` is assumed to already be in the debt's
 * own currency -- no conversion, same way a payment split across
 * multiple debts is two transactions rather than one transaction split
 * across two debts. Clamped at 0, matching the existing (pre-2.6)
 * `recordDebtPayment`'s own `Math.max(0, ...)` -- an overpayment doesn't
 * produce a negative debt once this is wired in, same as it doesn't today.
 *
 * Soft-deleted transactions are excluded, same reasoning as
 * derivedEfBalance above.
 */
export function derivedDebtBalance(debt: StoredDebt, transactions: StoredTransaction[]): number {
  const paid = transactions
    .filter((t) => t.debtId === debt.id && t.deletedAt == null)
    .reduce((s, t) => s + t.amount, 0);
  return roundMoney(Math.max(0, debt.openingBalance - paid));
}

/**
 * Phase 2.6.3b -- the transaction ledger with soft-deleted rows excluded.
 * What every normal read (spend totals, lists, category/currency/goal
 * aggregation, recurring-confirm status) is meant to see. The only
 * legitimate readers of the full array (deletedAt included) are the
 * "Recently deleted" recovery view itself and the delete/restore actions
 * that flip the field -- everything else should read through this instead
 * of re-deriving its own `t.deletedAt == null` filter inline.
 */
export function activeTransactions(transactions: StoredTransaction[]): StoredTransaction[] {
  return transactions.filter((t) => t.deletedAt == null);
}
