/**
 * The budget period — one place that answers "which period does this date
 * belong to", "what is the current period", and "how far into it are we".
 *
 * PHASE 1 IS DELIBERATELY INERT. `CYCLE_START_DAY` is hardcoded to 1, so
 * every function here returns exactly what the calendar-month arithmetic it
 * replaces returned. Nothing about the app's behaviour changes. What changes
 * is that the boundary is now expressed once instead of in 12 membership
 * filters, 28 key derivations and 3 month-walking loops — and that mixing a
 * cycle key with a calendar key stops compiling.
 *
 * ── Why the two key types are branded ────────────────────────────────────
 *
 * A cycle key and a calendar key are both `YYYY-MM` strings. They are
 * structurally identical and semantically different, which is precisely the
 * shape of 2.4.70 (a dollar figure beside the percentage that doesn't
 * produce it) and 2.4.81 (two anchoring mechanisms that agreed by
 * coincidence). Both were quiet until something moved.
 *
 * 2.4.87 recorded the requirement that came out of that: a reader mixing the
 * two must FAIL TO TYPE-CHECK. A doc comment does not satisfy it — 2.4.81
 * had one and it prevented nothing. Hence the brands. They cost nothing at
 * runtime and make the mistake unrepresentable.
 *
 * ── Why the format is still YYYY-MM ──────────────────────────────────────
 *
 * `valueForMonth` (localData.ts) is a lexical `h.ym <= ym` scan. It degrades
 * SILENTLY, not loudly, if key ordering ever stops matching chronological
 * ordering. For any start day 1..31 there is exactly one cycle starting per
 * calendar month (a 29th/30th/31st start clamps to the month's last day, as
 * nextOccurrence already does), so cycle keys stay bijective with calendar
 * months: same cardinality, same ordering, same format. The primitive is
 * safe to keep, unchanged.
 *
 * A cycle key names the calendar month the cycle STARTS in. At start day 1
 * that is the calendar month itself, which is why Phase 1 is a no-op.
 */

/** `YYYY-MM` of the calendar month a budget cycle STARTS in. */
export type CycleKey = string & { readonly __period: "cycle" };

/**
 * `YYYY-MM` of a literal calendar month. Distinct from CycleKey on purpose:
 * netWorthHistory stays calendar-keyed (owner's decision, 2.4.87) because it
 * holds point-in-time snapshots rather than as-of values, and relabelling a
 * snapshot into a period it was not taken in makes it a snapshot of neither.
 */
export type CalendarKey = string & { readonly __period: "calendar" };

/** A cycle-keyed history: incomeHistory, lbpRateHistory, budgetRuleHistory. */
export type CycleHistory<T = { value: number }> = ({ ym: CycleKey } & T)[];
/** A calendar-keyed history: netWorthHistory, and nothing else. */
export type CalendarHistory<T = { value: number }> = ({ ym: CalendarKey } & T)[];

/**
 * Boundary casts. Stored data arrives from JSON.parse as plain strings, so
 * SOMETHING has to assert the brand at the edge -- the alternative is a
 * runtime parse that would reject nothing, since both key spaces share a
 * format. Confining that assertion to two named functions makes every place
 * it happens greppable, which an inline `as CycleKey` scattered through the
 * load path would not be.
 *
 * Legitimate callers: the storage/migration boundary, and test fixtures.
 * Everywhere else should derive a key from a date (cycleKeyForDate,
 * cycleKeyForISO, currentCycleKey) so the compiler can check it.
 */
export const asCycleKey = (s: string): CycleKey => s as CycleKey;
export const asCalendarKey = (s: string): CalendarKey => s as CalendarKey;

/**
 * Phase 1: 1, i.e. calendar months. Phase 2b replaces this with a per-account
 * setting; nothing else in this module changes when it does.
 *
 * Phase 2a made `startDay` a REQUIRED parameter on every function below
 * rather than one defaulting to this constant. The default was a silent
 * fallback of exactly the kind 2.4.81 and 2.4.85 are about: a caller that
 * forgot it compiled cleanly and inherited calendar months. Required means
 * the compiler enumerates every period decision in the codebase -- which is
 * what Phase 2b needs, since it must change the ARGUMENT at each site rather
 * than this constant.
 */
export const CYCLE_START_DAY = 1;

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar month a Date falls in. */
export function calendarKeyForDate(d: Date): CalendarKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` as CalendarKey;
}

/** The calendar month an ISO `YYYY-MM-DD` string falls in, without parsing. */
export function calendarKeyForISO(iso: string): CalendarKey {
  return iso.slice(0, 7) as CalendarKey;
}

/**
 * The cycle a Date belongs to.
 *
 * At start day 1 this is the date's own calendar month. Above 1, a date
 * before the start day belongs to the cycle that began in the PREVIOUS
 * calendar month — the case that makes this a function rather than a slice.
 */
export function cycleKeyForDate(d: Date, startDay: number): CycleKey {
  const y = d.getFullYear();
  const m = d.getMonth();
  if (startDay <= 1 || d.getDate() >= effectiveStartDay(y, m, startDay)) {
    return `${y}-${pad(m + 1)}` as CycleKey;
  }
  const prev = new Date(y, m - 1, 1);
  return `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}` as CycleKey;
}

/** The cycle an ISO `YYYY-MM-DD` string belongs to. */
export function cycleKeyForISO(iso: string, startDay: number): CycleKey {
  if (startDay <= 1) return iso.slice(0, 7) as CycleKey;
  return cycleKeyForDate(parseISODateLocal(iso), startDay);
}

/** The cycle containing `now`. */
export function currentCycleKey(now: Date, startDay: number): CycleKey {
  return cycleKeyForDate(now, startDay);
}

/**
 * A start day past the end of a short month clamps to that month's last day,
 * matching nextOccurrence's own convention so a 31st payday behaves the same
 * way a 31st recurring charge already does.
 */
function effectiveStartDay(year: number, monthIndex: number, startDay: number): number {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(startDay, daysInMonth);
}

/** Local-midnight parse, matching parseLocalDate's reasoning in localData.ts. */
function parseISODateLocal(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** First and last instants of a cycle, as local dates. `end` is exclusive. */
export function cycleBounds(key: CycleKey, startDay: number): { start: Date; end: Date } {
  const [y, m] = key.split("-").map(Number);
  const mi = m - 1;
  const start = new Date(y, mi, effectiveStartDay(y, mi, startDay));
  const nextMi = mi + 1;
  const nextY = y + Math.floor(nextMi / 12);
  const nextM = ((nextMi % 12) + 12) % 12;
  const end = new Date(nextY, nextM, effectiveStartDay(nextY, nextM, startDay));
  return { start, end };
}

/** `n` cycles before `key` (n = 1 is the immediately preceding cycle). */
export function cycleKeyMinus(key: CycleKey, n: number): CycleKey {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` as CycleKey;
}

/** Whether an ISO-dated record falls inside a cycle. */
export function isInCycle(iso: string, key: CycleKey, startDay: number): boolean {
  if (startDay <= 1) return iso.startsWith(key);
  return cycleKeyForISO(iso, startDay) === key;
}

/**
 * How far into its cycle a date is (1-based), and how long that cycle is.
 *
 * Replaces `daysElapsed = now.getDate()` / `daysInMonth`, which drive
 * budgetPace and three user-facing strings. At start day 1 these return
 * exactly the calendar values; above 1 they are the only correct form, since
 * day-of-calendar-month says nothing about progress through a cycle that
 * began on the 27th. Phase 1 changes no output; Phase 2 relies on this.
 */
export function cycleProgress(now: Date, startDay: number): { daysInto: number; daysInCycle: number } {
  const { start, end } = cycleBounds(cycleKeyForDate(now, startDay), startDay);
  const DAY = 24 * 60 * 60 * 1000;
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysInCycle = Math.round((midnight(end) - midnight(start)) / DAY);
  const daysInto = Math.round((midnight(now) - midnight(start)) / DAY) + 1;
  return { daysInto: Math.max(1, daysInto), daysInCycle };
}
