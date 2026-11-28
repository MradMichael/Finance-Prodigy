// F4 (ROADMAP Phase 5; owner, session 56: built per session 55's plan, item 9, held for the owner's look): the
// monthly report. One period of the account's own cycle at a time, in US dollars, each lira row at its own day's
// rate (plan J, makeToUSDOn), from the rows themselves; nothing is stored. Every sentence is the owner's
// (approved in session 56), in REPORT_TEXT and the two sentence builders below, so the screen and the shared
// image say the same thing.
//
// What each section counts (live rows only: a deleted row counts nowhere):
// - Money in: the salary for the period (incomeForCycle, as periodTotals) as "Income", then Income entries by
//   category, "Extra income" for none (session 69, step D; was each entry by its own name). Its total is the
//   figure Statistics calls Income for the period.
// - Paid back and borrowed (session 69, step D): the Transfers that gained, by category ("Paid back: {category}",
//   "Paid back" for none), and each loan received by its debt ("Borrowed: {debt}"; a deleted debt's receipt by its
//   own description). Not a transfer's two legs, not a foreign-cash change-back (it nets in Where it went). Outside
//   Money in, with no total, and not compared with the period before.
// - Bills and debt payments: a recurring bill's confirmed rows by the bill's name, and debt payments (a row naming
//   a debt, not a correction) by the debt's name.
// - Where it went: spending by category (the shared spending rule, Needs and Wants; Savings has its own section),
//   largest first, the top six and then "Other", which also holds the built-in Other category so one line says it.
// - Saved: the Savings type, the safety net's change (rows that move it; corrections, stored at 0, left out), and
//   goal contributions. These overlap (a goal contribution is a Savings row), so the section has no total.
// - Goals: each goal not paused and made by the period's end: what it had at the end (today's figure for the
//   current period, as the Goals screen) and what was added in the period, in the goal's own currency.
// - Compared with the period before: a category or a section's figure that moved by CHANGE_MIN_PCT % AND by at
//   least CHANGE_MIN_USD, at most three, the largest move first. Compared in whole cents, so the edges are exact.
//   A figure that was 0 before has no percent to give and isn't compared.
import {
  cycleStartDayOf, makeToUSDOn, incomeForCycle, categoryLabel, goalProgress, goalPercent, liveGoalRows, contributionToGoal,
  roundMoney, isTransferLeg, type Currency, type LocalFinancials, type StoredTransaction,
} from "./localData";
import { transactionsInCycle, cycleKeyMinus, cycleKeyForISO, currentCycleKey, cycleBounds, cycleLabel, cycleLabelLong, periodNoun, type CycleKey } from "./period";
import { spendingEffect, spentByBucket, spentByCategory, categoryKey, isChangeBack } from "./spending";
import { fmtCur } from "../components/screens/shared";

export const CHANGE_MIN_PCT = 25;
export const CHANGE_MIN_USD = 50;
const TOP_CATEGORIES = 6;

export const REPORT_TEXT = {
  title: "Monthly report",
  picker: "Period",
  moneyIn: "Money in",
  // Session 69, step D (session 68's plan, S14-S18; approved): money in that isn't income.
  paidBackAndBorrowed: "Paid back and borrowed",
  notCounted: "Not counted in Money in.",
  paidBack: (category: string) => `Paid back: ${category}`,
  paidBackNone: "Paid back",
  borrowed: (debt: string) => `Borrowed: ${debt}`,
  bills: "Bills and debt payments",
  whereItWent: "Where it went",
  saved: "Saved",
  goals: "Goals",
  compared: (previous: string) => `Compared with ${previous}`,
  noChanges: (previous: string) => `No large changes from ${previous}.`,
  first: (noun: string) => `Nothing to compare yet: this is your first ${noun}.`,
  empty: (noun: string) => `No entries in this ${noun}.`,
  other: "Other",
  share: "Share this report",
  confirm: (noun: string) => `This image shows this ${noun}'s figures. Anyone you send it to will see them.`,
  confirmShare: "Share",
  confirmCancel: "Cancel",
  footer: "From ESSA. US dollars; lira at each day's rate.",
} as const;

// Labels the app already uses for these figures (not new words): Statistics' "Income", the type "Savings",
// Setup's "Safety net", the screen "Goals".
// "Extra income" (session 69, step D, S13; approved, D1 (a)): the entry form's own words for an Income entry.
const LINE = { income: "Income", extraIncome: "Extra income", savings: "Savings", safetyNet: "Safety net", goals: "Goals" } as const;

export interface ReportLine { label: string; usd: number }
export interface ReportSection { total: number; lines: ReportLine[] }
export interface GoalLine { name: string; currency: Currency; saved: number; target: number; percent: number; added: number }
export interface ReportChange { name: string; percent: number; amount: number; up: boolean }
export interface MonthlyReport {
  key: CycleKey; previous: CycleKey; noun: string; label: string; longLabel: string; previousLabel: string;
  empty: boolean; first: boolean;
  moneyIn: ReportSection; paidBackAndBorrowed: { lines: ReportLine[] }; bills: ReportSection; whereItWent: ReportSection; saved: { lines: ReportLine[] };
  goals: GoalLine[]; changes: ReportChange[];
}

/** The local day of a Date, as the rows store it. */
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const live = (rows: readonly StoredTransaction[]) => rows.filter((t) => t.deletedAt == null && t.purgedAt == null);

/** Lines summed by label, largest first, each to the cent. */
function grouped(pairs: [string, number][]): ReportLine[] {
  const by = new Map<string, number>();
  for (const [label, usd] of pairs) by.set(label, (by.get(label) ?? 0) + usd);
  return [...by].map(([label, usd]) => ({ label, usd: roundMoney(usd) })).sort((a, b) => b.usd - a.usd);
}
const total = (lines: ReportLine[]) => roundMoney(lines.reduce((s, l) => s + l.usd, 0));

/** One period's figures, without the comparison (also used for the period before). */
function figures(data: LocalFinancials, key: CycleKey) {
  const startDay = cycleStartDayOf(data);
  const toUSDOn = makeToUSDOn(data);
  const usd = (t: StoredTransaction) => toUSDOn(t.amount, t.currency, t.date);
  const rows = live(transactionsInCycle(data.transactions ?? [], key, startDay));

  const salary = incomeForCycle(data.incomeHistory, key, data.income);
  const incomeLabel = (t: StoredTransaction) => { const k = categoryKey(t.category); return k === "uncategorized" ? LINE.extraIncome : categoryLabel(k, data.customCategories); };
  const incomeRows = grouped(rows.filter((t) => t.bucket === "INCOME").map((t) => [incomeLabel(t), usd(t)]));
  const moneyInLines = [...(salary ? [{ label: LINE.income, usd: roundMoney(salary) }] : []), ...incomeRows];

  const all = data.transactions ?? [];
  const backLabel = (t: StoredTransaction) => {
    if (t.borrowedForDebtId) { const d = data.debts?.find((x) => x.id === t.borrowedForDebtId); return d ? REPORT_TEXT.borrowed(d.name) : t.description; }
    const k = categoryKey(t.category);
    return k === "uncategorized" ? REPORT_TEXT.paidBackNone : REPORT_TEXT.paidBack(categoryLabel(k, data.customCategories));
  };
  const backLines = grouped(rows.filter((t) => t.bucket === "TRANSFER" && t.amount > 0 && !isChangeBack(t) && !isTransferLeg(t, all)).map((t) => [backLabel(t), usd(t)]));

  const billPairs: [string, number][] = [];
  for (const t of rows) {
    if (t.recurringId != null) billPairs.push([data.recurring?.find((r) => r.id === t.recurringId)?.name ?? t.description, usd(t)]);
    else if (t.debtId != null && t.debtAdjustment == null && t.amount !== 0) billPairs.push([data.debts?.find((d) => d.id === t.debtId)?.name ?? t.description, usd(t)]);
  }
  const billLines = grouped(billPairs);

  const spending = rows.filter((t) => { const e = spendingEffect(t); return e != null && e.bucket !== "SAVINGS"; });
  const byCategory = spentByCategory(spending, usd);
  const ranked = [...byCategory].filter(([k, v]) => k !== "other" && v > 0).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, TOP_CATEGORIES).map(([k, v]) => ({ label: categoryLabel(k, data.customCategories), usd: roundMoney(v) }));
  const topKeys = new Set(ranked.slice(0, TOP_CATEGORIES).map(([k]) => k));
  const rest = [...byCategory].filter(([k]) => !topKeys.has(k)).reduce((s, [, v]) => s + v, 0);
  const whereLines = [...top, ...(roundMoney(rest) !== 0 ? [{ label: REPORT_TEXT.other, usd: roundMoney(rest) }] : [])];

  const savings = spentByBucket(rows, usd).savings;
  const safetyNet = rows.filter((t) => t.efAmount != null && t.amount !== 0).reduce((s, t) => s + (t.efAmount ?? 0), 0);
  const toGoals = rows.filter((t) => t.goalId != null && t.amount !== 0).reduce((s, t) => s + usd(t), 0);

  return {
    rows, byCategory,
    moneyIn: { total: total(moneyInLines), lines: moneyInLines },
    paidBackAndBorrowed: { lines: backLines },
    bills: { total: total(billLines), lines: billLines },
    whereItWent: { total: roundMoney([...byCategory.values()].reduce((s, v) => s + v, 0)), lines: whereLines },
    saved: { lines: [{ label: LINE.savings, usd: roundMoney(savings) }, { label: LINE.safetyNet, usd: roundMoney(safetyNet) }, { label: LINE.goals, usd: roundMoney(toGoals) }] },
    savings: roundMoney(savings),
  };
}

/** The periods the picker offers: this one, then each one before it back to the first live entry's. */
export function reportPeriods(data: LocalFinancials, now: Date): CycleKey[] {
  const startDay = cycleStartDayOf(data);
  const current = currentCycleKey(now, startDay);
  let earliest: string | null = null;
  for (const t of data.transactions ?? []) if (t.deletedAt == null && t.purgedAt == null && (earliest === null || t.date < earliest)) earliest = t.date;
  const out: CycleKey[] = [current];
  if (earliest === null) return out;
  const first = cycleKeyForISO(earliest, startDay);
  for (let k = cycleKeyMinus(current, 1); k >= first && out.length < 600; k = cycleKeyMinus(k, 1)) out.push(k);
  return out;
}

export function buildMonthlyReport(data: LocalFinancials, key: CycleKey, now: Date): MonthlyReport {
  const startDay = cycleStartDayOf(data);
  const previous = cycleKeyMinus(key, 1);
  const { start, end } = cycleBounds(key, startDay);
  const startISO = dayOf(start), endISO = dayOf(end);
  const cur = figures(data, key);
  const empty = cur.rows.length === 0;
  const first = !(data.transactions ?? []).some((t) => t.deletedAt == null && t.purgedAt == null && t.date < startISO);
  const isCurrent = key === currentCycleKey(now, startDay);

  const goals: GoalLine[] = (data.goals ?? [])
    .filter((g) => !g.pausedAt && (g.createdAt ?? "").slice(0, 10) < endISO)
    .map((g) => {
      const rows = liveGoalRows(data.transactions ?? [], g.id);
      const saved = isCurrent || g.openingAmount == null ? goalProgress(g, data)
        : roundMoney(g.openingAmount + rows.filter((t) => t.date < endISO).reduce((s, t) => s + contributionToGoal(t, g, data), 0));
      const added = roundMoney(rows.filter((t) => t.amount !== 0 && t.date >= startISO && t.date < endISO).reduce((s, t) => s + contributionToGoal(t, g, data), 0));
      return { name: g.name, currency: g.currency, saved, target: g.targetAmount, percent: goalPercent(saved, g.targetAmount, g.targetAmount <= 0 || saved >= g.targetAmount), added };
    });

  let changes: ReportChange[] = [];
  if (!first && !empty) {
    const prev = figures(data, previous);
    const pairs = new Map<string, [number, number]>([
      [REPORT_TEXT.moneyIn, [prev.moneyIn.total, cur.moneyIn.total]],
      [REPORT_TEXT.bills, [prev.bills.total, cur.bills.total]],
      [LINE.savings, [prev.savings, cur.savings]],
    ]);
    for (const k of new Set([...prev.byCategory.keys(), ...cur.byCategory.keys()])) {
      pairs.set(categoryLabel(k, data.customCategories), [prev.byCategory.get(k) ?? 0, cur.byCategory.get(k) ?? 0]);
    }
    const moved: (ReportChange & { cents: number })[] = [];
    for (const [name, [before, after]] of pairs) {
      const pc = Math.round(before * 100), cc = Math.round(after * 100);
      if (pc <= 0) continue;
      const dc = Math.abs(cc - pc);
      if (dc * 100 >= CHANGE_MIN_PCT * pc && dc >= CHANGE_MIN_USD * 100) moved.push({ name, percent: Math.round((dc / pc) * 100), amount: dc / 100, up: cc > pc, cents: dc });
    }
    changes = moved.sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)).slice(0, 3).map(({ cents: _cents, ...c }) => c);
  }

  return {
    key, previous, noun: periodNoun(startDay), label: cycleLabel(key, startDay), longLabel: cycleLabelLong(key, startDay), previousLabel: cycleLabel(previous, startDay),
    empty, first,
    moneyIn: cur.moneyIn, paidBackAndBorrowed: cur.paidBackAndBorrowed, bills: cur.bills, whereItWent: cur.whereItWent, saved: cur.saved,
    goals, changes,
  };
}

/** "{Category} was {percent}% higher than {previous period} ({amount} more)." and its "lower … less" twin. */
export function changeSentence(c: ReportChange, previousLabel: string): string {
  return `${c.name} was ${c.percent}% ${c.up ? "higher" : "lower"} than ${previousLabel} (${fmtCur(c.amount, "USD")} ${c.up ? "more" : "less"}).`;
}

/** "{goal}: {saved} of {target} ({percent}%), {added} added this {period}." */
export function goalSentence(g: GoalLine, noun: string): string {
  return `${g.name}: ${fmtCur(g.saved, g.currency)} of ${fmtCur(g.target, g.currency)} (${g.percent}%), ${fmtCur(g.added, g.currency)} added this ${noun}.`;
}
