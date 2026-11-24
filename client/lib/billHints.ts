// "Bills you log by hand" (ROADMAP Phase 6, F5's undeclared recurring charges; planned in session 61, built in
// session 62 with every drafted sentence approved). The bills a person keeps logging by hand every month (the
// generator, internet, the phone recharge), offered as recurring items. Derived from the rows on every call; the
// only thing stored is the list of hints set aside ("Not a bill", `billHintsSetAside`).
//
// The rule (FIX_PLANS session 61, item 3; the owner's session 62 changes):
// - rows: live (not deleted, not purged), Needs or Wants, dated today or earlier, not tied to anything already
//   tracked (a recurring item's confirmation or extra payment, a debt, a goal, foreign cash), from the start of the
//   period four periods back (the account's own cycle) to today;
// - grouped by description (trimmed, lower case, spaces collapsed) and currency;
// - a bill: at least BILL_MIN_PAYMENTS rows; every gap between consecutive rows BILL_GAP_MIN_DAYS to
//   BILL_GAP_MAX_DAYS days (once a month: groceries, coffee and lunch repeat within days); the latest at most
//   BILL_STALE_DAYS old (two missed months: it has stopped); every amount within BILL_BAND of the median, in its
//   own currency, nothing converted (owner, session 62: 50%, so metered generator, electricity and water bills are
//   caught); no recurring item with that name; not set aside;
// - monthly only; at most BILL_MAX_HINTS, the most recent first.
// `linkedPaymentId` is not read: its contract says no derivation may (a split monthly bill is one hint per leg).
import { cycleStartDayOf, buildQuickRecurring, quickRecurringStart, edited, todayISO, type Currency, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "./localData";
import { cycleBounds, cycleKeyForISO, cycleKeyMinus } from "./period";

export const BILL_GAP_MIN_DAYS = 20;
export const BILL_GAP_MAX_DAYS = 40;
export const BILL_STALE_DAYS = 62;
export const BILL_BAND = 0.5;
export const BILL_MIN_PAYMENTS = 3;
export const BILL_MAX_HINTS = 5;
const WINDOW_PERIODS = 4;

/** Every sentence the card shows (approved by the owner as drafted, session 62). */
export const BILL_TEXT = {
  heading: "Bills you log by hand",
  lead: "These came up about once a month for the last few months. Add one as recurring and ESSA will remind you when it's due.",
  about: (amount: string, date: string) => `About ${amount} a month, last on ${date}.`,
  add: "Add as recurring",
  notABill: "Not a bill",
  added: (name: string, date: string) => `${name} is now recurring. First due ${date}.`,
  setAside: (name: string) => `${name} won't be suggested again.`,
  undo: "Undo",
} as const;

export interface BillHint {
  key: string;
  /** The latest payment's description, as typed (trimmed). */
  name: string;
  /** The latest payment's amount, in its own currency. */
  amount: number;
  currency: Currency;
  bucket: "NEEDS" | "WANTS";
  category?: string;
  lastDate: string;
  count: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** A hint's key: its description (trimmed, lower case, spaces collapsed) and its currency. */
export const billHintKey = (description: string, currency: Currency): string => `${norm(description)}|${currency}`;
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
const isoOfLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tracked = (t: StoredTransaction) => !!(t.recurringId || t.extraForRecurringId || t.debtId || t.goalId || t.fx);

export function billHints(data: LocalFinancials, today: string = todayISO()): BillHint[] {
  const startDay = cycleStartDayOf(data);
  const from = isoOfLocal(cycleBounds(cycleKeyMinus(cycleKeyForISO(today, startDay), WINDOW_PERIODS), startDay).start);
  const declared = new Set((data.recurring ?? []).map((r) => norm(r.name)));
  const aside = new Set(data.billHintsSetAside ?? []);
  const groups = new Map<string, StoredTransaction[]>();
  for (const t of data.transactions ?? []) {
    if (t.deletedAt != null || t.purgedAt != null) continue;
    if (t.bucket !== "NEEDS" && t.bucket !== "WANTS") continue;
    if (tracked(t) || t.date < from || t.date > today) continue;
    const key = billHintKey(t.description, t.currency);
    const list = groups.get(key);
    if (list) list.push(t); else groups.set(key, [t]);
  }
  const hints: BillHint[] = [];
  for (const [key, rows] of groups) {
    if (rows.length < BILL_MIN_PAYMENTS || aside.has(key) || declared.has(key.slice(0, key.lastIndexOf("|")))) continue;
    rows.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.createdAt ?? "") < (b.createdAt ?? "") ? -1 : 1));
    let monthly = true;
    for (let i = 1; i < rows.length && monthly; i++) {
      const gap = dayNumber(rows[i].date) - dayNumber(rows[i - 1].date);
      monthly = gap >= BILL_GAP_MIN_DAYS && gap <= BILL_GAP_MAX_DAYS;
    }
    if (!monthly) continue;
    const last = rows[rows.length - 1];
    if (dayNumber(today) - dayNumber(last.date) > BILL_STALE_DAYS) continue;
    const amounts = rows.map((t) => t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor((amounts.length - 1) / 2)];
    if (!(median > 0) || !amounts.every((a) => Math.abs(a - median) <= BILL_BAND * median)) continue;
    hints.push({
      key, name: last.description.trim(), amount: last.amount, currency: last.currency, bucket: last.bucket as "NEEDS" | "WANTS",
      ...(last.category ? { category: last.category } : {}), lastDate: last.date, count: rows.length,
    });
  }
  return hints
    .sort((a, b) => (a.lastDate !== b.lastDate ? (a.lastDate < b.lastDate ? 1 : -1) : a.name.localeCompare(b.name)))
    .slice(0, BILL_MAX_HINTS);
}

/**
 * "Add as recurring": one monthly item from the latest payment (its name, amount, currency, type and category),
 * starting one month after the latest payment of that bill (session 62, item 1's rule, `quickRecurringStart`), so
 * the period already logged by hand is never asked for again. The rows are not touched.
 */
export function addBillAsRecurring(data: LocalFinancials, hint: BillHint, today: string = todayISO()): { data: LocalFinancials; item: StoredRecurring } {
  const start = quickRecurringStart(hint.name, data.transactions ?? [], hint.lastDate, today);
  const rec = buildQuickRecurring(hint.name, String(hint.amount), hint.currency, hint.bucket, hint.category ?? "", start);
  if (!rec) throw new Error("a bill hint always has a name and an amount");
  const item = edited(rec);
  return { data: { ...data, recurring: [...(data.recurring ?? []), item] }, item };
}

/** "Not a bill": the hint's key, kept once. */
export function setBillAside(data: LocalFinancials, key: string): LocalFinancials {
  return { ...data, billHintsSetAside: [...new Set([...(data.billHintsSetAside ?? []), key])] };
}

/** Its Undo. */
export function undoBillAside(data: LocalFinancials, key: string): LocalFinancials {
  return { ...data, billHintsSetAside: (data.billHintsSetAside ?? []).filter((k) => k !== key) };
}
