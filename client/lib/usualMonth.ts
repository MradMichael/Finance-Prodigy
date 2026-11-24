// "Your usual month" (ROADMAP Phase 6, F5; built in session 60, the wording approved by the owner in session 61). Each
// spending category this period so far, against the person's own average of the three periods before it, and at
// most three plain lines for a category already well above its usual month. Derived from the rows on every call;
// nothing is stored or synced. The money rule (FIX_PLANS session 60, Part 2):
// - spending is the shared rule (`spendingEffect`): Needs and Wants by category, a change-back netted against Wants
//   in its own category; Savings has its own figures elsewhere; live rows only; each row at its own day's rate
//   (plan J, `makeToUSDOn`); US dollars;
// - periods are the account's own cycle; "this period so far" is every live row in the current period;
// - the usual month = the three previous periods' spending ÷ 3 (a period without that category counts 0), and only
//   when each of those periods has at least one live entry (else a quiet month can't be told from one not logged);
// - a line when this period so far is above the usual month by USUAL_MIN_PCT % AND USUAL_MIN_USD, compared in whole
//   cents; none for a category with no usual spending; never for a category below it (the period isn't over); never
//   for "Uncategorized" (owner, session 61: it names nothing to act on; its row stays in the table); at most three,
//   the largest difference first.
import { cycleStartDayOf, makeToUSDOn, categoryLabel, roundMoney, type LocalFinancials, type StoredTransaction } from "./localData";
import { transactionsInCycle, currentCycleKey, cycleKeyMinus, periodNoun, type CycleKey } from "./period";
import { spendingEffect, spentByCategory } from "./spending";
import { money } from "../components/screens/shared";

export const USUAL_MIN_PCT = 25;
export const USUAL_MIN_USD = 50;
const PERIODS = 3;
const MAX_LINES = 3;

/** Every sentence the card shows (approved by the owner as drafted, session 61). */
export const USUAL_TEXT = {
  heading: (noun: string) => `Your usual ${noun}`,
  lead: (noun: string, plural: string) => `This ${noun} so far, against the average of your last three ${plural}.`,
  none: (noun: string) => `Nothing is above your usual ${noun} so far.`,
  soFar: "So far",
  usual: "Usual",
  empty: (noun: string, plural: string) => `Your usual ${noun} shows once each of your last three ${plural} has entries.`,
} as const;

export interface UsualRow { key: string; label: string; soFar: number; usual: number }
export interface UsualObservation { label: string; percent: number; amount: number }
export interface UsualMonth { ready: boolean; noun: string; nounPlural: string; rows: UsualRow[]; observations: UsualObservation[] }

const live = (rows: readonly StoredTransaction[]) => rows.filter((t) => t.deletedAt == null && t.purgedAt == null);
/** The rows `categoryLabel` calls "Uncategorized": no category (grouped as "uncategorized"), or an empty one. */
const uncategorized = (key: string) => !key || key === "uncategorized";

export function usualMonth(data: LocalFinancials, now: Date): UsualMonth {
  const startDay = cycleStartDayOf(data);
  const noun = periodNoun(startDay);
  const nounPlural = `${noun}s`;
  const list = data.transactions ?? [];
  const toUSDOn = makeToUSDOn(data);
  const usd = (t: StoredTransaction) => toUSDOn(t.amount, t.currency, t.date);
  const spending = (key: CycleKey) => {
    const rows = live(transactionsInCycle(list, key, startDay));
    const spent = rows.filter((t) => { const e = spendingEffect(t); return e != null && e.bucket !== "SAVINGS"; });
    // Owner, session 62: an empty category (only from an imported backup) is no category: one "Uncategorized" row.
    return { count: rows.length, byCategory: spentByCategory(spent, usd, (t) => t.category || "uncategorized") };
  };

  const current = currentCycleKey(now, startDay);
  const now_ = spending(current);
  const previous = Array.from({ length: PERIODS }, (_, i) => spending(cycleKeyMinus(current, i + 1)));
  const ready = previous.every((p) => p.count > 0);

  const keys = new Set<string>([...now_.byCategory.keys(), ...previous.flatMap((p) => [...p.byCategory.keys()])]);
  const rows: UsualRow[] = [...keys]
    .map((key) => ({
      key,
      label: categoryLabel(key, data.customCategories),
      soFar: roundMoney(now_.byCategory.get(key) ?? 0),
      usual: roundMoney(previous.reduce((s, p) => s + (p.byCategory.get(key) ?? 0), 0) / PERIODS),
    }))
    .filter((r) => r.soFar !== 0 || r.usual !== 0)
    .sort((a, b) => b.usual - a.usual || b.soFar - a.soFar || a.label.localeCompare(b.label));

  const observations: (UsualObservation & { cents: number })[] = [];
  if (ready) {
    for (const r of rows) {
      if (uncategorized(r.key)) continue;
      const uc = Math.round(r.usual * 100), cc = Math.round(r.soFar * 100);
      if (uc <= 0 || cc <= uc) continue;
      const dc = cc - uc;
      if (dc * 100 >= USUAL_MIN_PCT * uc && dc >= USUAL_MIN_USD * 100) observations.push({ label: r.label, percent: Math.round((dc / uc) * 100), amount: dc / 100, cents: dc });
    }
  }
  return {
    ready, noun, nounPlural,
    rows: ready ? rows : [],
    observations: observations.sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label)).slice(0, MAX_LINES).map(({ cents: _cents, ...o }) => o),
  };
}

/** "{Category} is already {percent}% above your usual {period} ({amount} more)." */
export function usualSentence(o: UsualObservation, noun: string): string {
  return `${o.label} is already ${o.percent}% above your usual ${noun} (${money(o.amount)} more).`;
}
