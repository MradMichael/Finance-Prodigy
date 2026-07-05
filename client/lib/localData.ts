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
  bucket: "NEEDS" | "WANTS" | "SAVINGS";
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
  startDate: string;      // YYYY-MM-DD
  endDate: string | null; // null = infinite (unless totalAmount is set)
  totalAmount: number | null; // ends once this cumulative amount has been paid
  createdAt: string;      // ISO — when added to ESSA
}

export type BudgetRuleKey = "40-30-30" | "50-30-20" | "60-20-20" | "70-20-10" | "80-15-5" | "custom";

export const BUDGET_RULES: Record<BudgetRuleKey, { label: string; desc: string; needs: number; wants: number; savings: number }> = {
  "40-30-30": { label: "40 / 30 / 30", desc: "Aggressive saver — maximize wealth",        needs: 40, wants: 30, savings: 30 },
  "50-30-20": { label: "50 / 30 / 20", desc: "Standard — balanced lifestyle",              needs: 50, wants: 30, savings: 20 },
  "60-20-20": { label: "60 / 20 / 20", desc: "Balanced — higher essential spending",       needs: 60, wants: 20, savings: 20 },
  "70-20-10": { label: "70 / 20 / 10", desc: "Tight budget — high-cost or lower income",  needs: 70, wants: 20, savings: 10 },
  "80-15-5":  { label: "80 / 15 / 5",  desc: "Survival — when every dollar counts",       needs: 80, wants: 15, savings: 5  },
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
  budgetRule: "50-30-20",
};

function storageKey(userId: string) { return `essa_data_${userId}`; }

export async function loadData(userId: string): Promise<LocalFinancials> {
  if (typeof window === "undefined") return DEFAULT_DATA;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_DATA;
    const { decryptJSON } = await import("./crypto");
    const plain = await decryptJSON(raw);
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

/** Format an ISO date string (YYYY-MM-DD or full ISO) as DD/MM/YYYY for display. */
export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Monthly cost of a recurring item as of a given date, 0 if not yet started or already ended. */
export function monthlyEquivalent(r: StoredRecurring, asOf: Date = new Date()): number {
  const start = new Date(r.startDate);
  if (asOf < start) return 0;

  // End by total amount: stop once cumulative payments have hit the limit
  if (r.totalAmount != null && r.totalAmount > 0 && r.amount > 0) {
    const totalPeriods = r.totalAmount / r.amount;
    const totalMs = (totalPeriods / FREQ_MONTHLY[r.frequency]) * 30.4375 * 24 * 60 * 60 * 1000;
    if (asOf.getTime() > start.getTime() + totalMs) return 0;
  }

  const end = r.endDate ? new Date(r.endDate) : null;
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

  const monthLen = MONTH_FREQ_LENGTH[r.frequency] ?? 1;
  const next = new Date(start);
  while (next <= asOf) next.setMonth(next.getMonth() + monthLen);
  return next;
}

/** How much has been paid so far on a totalAmount-capped recurring item. */
export function recurringPaidSoFar(r: StoredRecurring, asOf: Date = new Date()): number {
  if (!r.totalAmount || r.amount <= 0) return 0;
  const start = new Date(r.startDate);
  if (asOf <= start) return 0;
  const monthsElapsed = (asOf.getTime() - start.getTime()) / (30.4375 * 24 * 60 * 60 * 1000);
  const periodsElapsed = Math.floor(monthsElapsed * FREQ_MONTHLY[r.frequency]);
  return Math.min(r.totalAmount, periodsElapsed * r.amount);
}
