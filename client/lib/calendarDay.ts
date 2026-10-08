// A calendar day, "YYYY-MM-DD": no time, no zone (session 4 item 7).
//
// The recurring engine used to take instants. Callers built "today" as the
// UTC midnight of their local day, and nextOccurrence read that instant back
// by its LOCAL day -- yesterday, west of UTC. A branded type makes "a day" a
// different thing from "an instant", so the compiler lists every call site
// that has to say which day it means.
//
// Occurrences stay UTC-midnight Dates (dayStart): every reader of them
// already takes their day with toISOString().slice(0, 10) (occurrenceDay).

export type CalendarDay = string & { readonly __brand: "CalendarDay" };

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** A "YYYY-MM-DD" string as a calendar day; throws on anything else. */
export function asCalendarDay(s: string): CalendarDay {
  if (!SHAPE.test(s)) throw new Error(`Not a calendar day: ${JSON.stringify(s)}`);
  return s as CalendarDay;
}

/**
 * A STORED date (a recurring item's start, end or cutover) as a calendar day,
 * without throwing: stored data can be old or imported, and a throw would take
 * a whole screen down. "YYYY-MM-DD..." keeps its first ten characters (an ISO
 * instant keeps its UTC day, as `new Date(s)` read it before). Anything else
 * passes through unchanged and becomes an invalid date downstream, exactly as
 * `new Date(s)` did before: this change neither adds nor removes a failure
 * for malformed stored data.
 */
export function storedDay(s: string): CalendarDay {
  const head = s.slice(0, 10);
  return (SHAPE.test(head) ? head : s) as CalendarDay;
}

/** The LOCAL calendar day of an instant -- what "today" means to the person holding the device. */
export function calendarDayOf(d: Date): CalendarDay {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` as CalendarDay;
}

/** Today, on this device. */
export function todayCalendarDay(now: Date = new Date()): CalendarDay {
  return calendarDayOf(now);
}

/** The UTC midnight a day's occurrences are built on (and compared with). */
export function dayStart(day: CalendarDay): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The day of an occurrence (a UTC-midnight Date). */
export function occurrenceDay(occurrence: Date): CalendarDay {
  return occurrence.toISOString().slice(0, 10) as CalendarDay;
}

/** `n` calendar days later (or earlier): plain UTC arithmetic, so no clock change can skip or repeat one. */
export function addDays(day: CalendarDay, n: number): CalendarDay {
  const d = dayStart(day);
  d.setUTCDate(d.getUTCDate() + n);
  return occurrenceDay(d);
}
