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
  // INCOME is a one-off/incidental receipt (a gift, a reimbursement) logged as
  // a dated transaction like any other -- distinct from the recurring salary
  // set in Setup. StoredRecurring.bucket deliberately stays NEEDS/WANTS/SAVINGS
  // only: recurring income already has its own home (the Setup income field).
  bucket: "NEEDS" | "WANTS" | "SAVINGS" | "INCOME";
  // Optional, finer-grained than bucket (e.g. "Groceries" vs. the Needs
  // bucket it rolls up into) -- purely descriptive/for charting, never fed
  // into budget/EF/rollover/projection math, so it's safe to leave unset on
  // old entries or skip entirely.
  category?: CategoryKey;
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
  targetDate: string;   // YYYY-MM-DD
  createdAt: string;    // ISO — when added to ESSA
  achievedAt?: string;  // ISO — when goal was completed
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
  actualBalance?: number;   // last balance you told it you actually have
  actualBalanceDate?: string; // ISO — when you last confirmed it
}

export interface StoredAsset {
  id: string;
  name: string;      // e.g. "Car", "Brokerage account"
  value: number;
  currency: Currency;
  createdAt: string; // ISO
}

export interface StoredDebt {
  id: string;
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
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
  frequency: RecurringFrequency;
  bucket: "NEEDS" | "WANTS" | "SAVINGS";
  // Same optional, display-only role as StoredTransaction.category.
  category?: CategoryKey;
  startDate: string;      // YYYY-MM-DD
  endDate: string | null; // null = infinite (unless totalAmount is set)
  totalAmount: number | null; // ends once this cumulative amount has been paid
  createdAt: string;      // ISO — when added to ESSA
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

export type BudgetRuleKey = "40-30-30" | "50-30-20" | "60-20-20" | "70-20-10" | "80-15-5" | "custom";

export const BUDGET_RULES: Record<BudgetRuleKey, { label: string; desc: string; needs: number; wants: number; savings: number }> = {
  "40-30-30": { label: "40 / 30 / 30", desc: "Aggressive saver: maximize wealth",        needs: 40, wants: 30, savings: 30 },
  "50-30-20": { label: "50 / 30 / 20", desc: "Standard, balanced lifestyle",              needs: 50, wants: 30, savings: 20 },
  "60-20-20": { label: "60 / 20 / 20", desc: "Balanced, higher essential spending",       needs: 60, wants: 20, savings: 20 },
  "70-20-10": { label: "70 / 20 / 10", desc: "Tight budget, high-cost or lower income",  needs: 70, wants: 20, savings: 10 },
  "80-15-5":  { label: "80 / 15 / 5",  desc: "Survival: when every dollar counts",       needs: 80, wants: 15, savings: 5  },
  "custom":   { label: "Custom",       desc: "Set your own percentages",                   needs: 50, wants: 30, savings: 20 },
};

export interface LocalFinancials {
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
}

export const DEFAULT_DATA: LocalFinancials = {
  userName: "You",
  income: 0,
  lbpRate: 89500,
  emergencyFundTargetMonths: 6,
  emergencyFundBalance: 0,
  transactions: [],
  goals: [],
  debts: [],
  recurring: [],
  cards: [],
  assets: [],
  trackedBalances: [],
  netWorthHistory: [],
  incomeHistory: [],
  lbpRateHistory: [],
  budgetRuleHistory: [],
  budgetRule: "50-30-20",
};

/** True when an account has literally nothing entered yet (fresh sign-up defaults) — used to gate the one-time auto-pull-on-first-load in app/page.tsx so it only ever fires for a genuinely blank local account, never silently overwriting real local data. */
export function isEmptyFinancials(data: LocalFinancials): boolean {
  return data.income === 0
    && data.emergencyFundBalance === 0
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
  return best ? { needs: best.needs, wants: best.wants, savings: best.savings } : fallback;
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
    return { ...DEFAULT_DATA, ...JSON.parse(plain) };
  } catch {
    return DEFAULT_DATA;
  }
}

export async function saveData(data: LocalFinancials, userId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const { encryptJSON } = await import("./crypto");
  const stored = await encryptJSON(JSON.stringify(data));
  localStorage.setItem(storageKey(userId), stored);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Converts an amount to USD given its own currency and the current LBP rate — was independently redefined as the same one-liner in computeDashboard.ts, InputPanel.tsx, RecurringScreen.tsx, and TransactionsScreen.tsx. */
export function toUSD(amount: number, currency: Currency | undefined, lbpRate: number): number {
  return currency === "LBP" ? amount / lbpRate : amount;
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

/** Monthly cost of a recurring item as of a given date, 0 if not yet started or already ended. */
export function monthlyEquivalent(r: StoredRecurring, asOf: Date = new Date()): number {
  const start = parseLocalDate(r.startDate);
  if (asOf < start) return 0;

  // End by total amount: stop once cumulative payments have hit the limit
  if (r.totalAmount != null && r.totalAmount > 0 && r.amount > 0) {
    const totalPeriods = r.totalAmount / r.amount;
    const totalMs = (totalPeriods / FREQ_MONTHLY[r.frequency]) * 30.4375 * 24 * 60 * 60 * 1000;
    if (asOf.getTime() > start.getTime() + totalMs) return 0;
  }

  const end = r.endDate ? parseLocalDate(r.endDate) : null;
  if (end && asOf > end) return 0;

  return r.amount * FREQ_MONTHLY[r.frequency];
}

const DAY_FREQ_LENGTH: Partial<Record<RecurringFrequency, number>> = { weekly: 7, biweekly: 14 };
const MONTH_FREQ_LENGTH: Partial<Record<RecurringFrequency, number>> = {
  monthly: 1, every2months: 2, quarterly: 3, biannually: 6, yearly: 12,
};

/** Next date this recurring item is due on/after `asOf`, or null if it's already ended (by end date or total-amount cap). */
export function nextOccurrence(r: StoredRecurring, asOf: Date = new Date()): Date | null {
  const start = new Date(r.startDate);
  if (r.endDate && asOf > new Date(r.endDate)) return null;
  if (r.totalAmount != null && r.totalAmount > 0 && recurringPaidSoFar(r, asOf) >= r.totalAmount) return null;
  if (asOf <= start) return start;

  const dayLen = DAY_FREQ_LENGTH[r.frequency];
  if (dayLen != null) {
    const msPerPeriod = dayLen * 24 * 60 * 60 * 1000;
    const periodsElapsed = Math.floor((asOf.getTime() - start.getTime()) / msPerPeriod);
    return new Date(start.getTime() + (periodsElapsed + 1) * msPerPeriod);
  }

  // Clamp to the target month's actual last day instead of letting
  // Date.setMonth overflow into the following month — a naive
  // next.setMonth(next.getMonth() + monthLen) on Jan 31 + 1 month lands on
  // March 3 (Feb only has 28/29 days), silently skipping a February
  // occurrence and shifting the recurring day going forward.
  const monthLen = MONTH_FREQ_LENGTH[r.frequency] ?? 1;
  const targetDay = start.getUTCDate();
  let next = new Date(start);
  while (next <= asOf) {
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
