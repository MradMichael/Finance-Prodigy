// Phase 2.8.5c (owner-approved, session 42): two devices correcting the same
// account before they sync (LB3 / 2.4.58).
//
// A correction row states a balance ("the fund really holds $950") but stores
// only the difference from what its device showed. Merged, two devices'
// corrections to one account were both applied: a figure neither device
// entered. The rule, approved by the owner:
//
//   * A CLASH is at least one new correction for the same account on each
//     side of a merge. "New" = present on one side only: transactions are
//     never removed (only tombstoned), so a row one copy lacks was made since
//     the copies last met. No clock decides whether it's a clash.
//   * The later statement stays (creation time, id breaking a tie). The OTHER
//     side's new corrections are set aside: soft-deleted, so they sit in
//     Recently deleted, restorable, and intact. The kept side's own earlier new
//     corrections stay, because the kept one was computed on top of them.
//   * A correction on one side crossing an ordinary movement on the other (a
//     payment, a contribution, a spend from the fund) can't be settled: the
//     movement is real money and whether the statement already counted it is
//     unknowable. Nothing is set aside; the result is reported.
//   * A clash that includes a period close's correction row is reported, not
//     settled: the close's record points at that row.
//
// Pure. Wired into mergeFinancials in 2.8.5d. Figures are in each account's
// own unit (an emergency fund in USD, a debt or goal in its currency).
import {
  isCorrectionFor, softDelete, derivedEfBalance, derivedDebtBalance, goalProgress, roundMoney,
  type CorrectionAccount, type Currency, type LocalFinancials, type StoredTransaction,
} from "./localData";
import { fingerprint } from "./syncSeen";

/** One settled or reported clash, for the merge notice (2.8.5d). */
export interface CorrectionClash {
  kind: "correction";
  /** later: settled, the later statement kept. same: settled, both stated the same figure. close: reported, a period close's row is involved. crossed: reported, a correction crossed a movement. */
  how: "later" | "same" | "close" | "crossed";
  account: "ef" | "debt" | "goal";
  /** "ef", "debt:<id>" or "goal:<id>". */
  key: string;
  name: string;
  currency: Currency;
  /** The kept (or, crossed: the correcting side's latest) statement; null when its row carries none that still matches it. */
  kept: number | null;
  /** The other side's latest statement (null as above; always null when crossed). */
  other: number | null;
  /** crossed only: what the other side's movements changed the balance by (internal: the notice never shows its sign). */
  moved?: number;
  /** crossed only: how many movements, and which way each moved the balance: all up, all down, or mixed (one with no effect counts as mixed). */
  movedCount?: number;
  movedDirection?: "up" | "down" | "mixed";
  /** close and crossed: the balance now, with both kept. */
  result?: number;
  /** Fingerprint of the account and the rows involved: the same clash merged on two devices is one record. */
  id: string;
}

interface Account {
  key: string;
  account: CorrectionClash["account"];
  test: CorrectionAccount;
  name: string;
  currency: Currency;
  /** Rows that move this account without stating it. */
  moves: (t: StoredTransaction) => boolean;
  balance: (d: LocalFinancials) => number;
}

function accountsOf(d: LocalFinancials): Account[] {
  return [
    {
      key: "ef", account: "ef", test: "ef", name: "Safety net", currency: "USD",
      moves: (t) => t.efAmount != null,
      balance: (x) => derivedEfBalance(x),
    },
    ...(d.debts ?? []).map((debt): Account => ({
      key: `debt:${debt.id}`, account: "debt", test: { debtId: debt.id }, name: debt.name, currency: debt.currency,
      moves: (t) => t.debtId === debt.id,
      balance: (x) => derivedDebtBalance(debt, x.transactions, x),
    })),
    ...(d.goals ?? []).map((goal): Account => ({
      key: `goal:${goal.id}`, account: "goal", test: { goalId: goal.id }, name: goal.name, currency: goal.currency,
      moves: (t) => t.goalId === goal.id,
      balance: (x) => goalProgress(goal, x),
    })),
  ];
}

/** The row's statement, if it has one that still matches the difference it applies (an edit since would make it stale). */
function statedOf(t: StoredTransaction): number | null {
  const c = t.correction;
  if (!c) return null;
  const implied = c.account === "debt" ? c.base - c.stated : c.stated - c.base;
  const applied = c.account === "ef" ? t.efAmount : c.account === "debt" ? t.debtAdjustment : t.goalAmount;
  return applied != null && roundMoney(implied) === roundMoney(applied) ? c.stated : null;
}

const byCreation = (a: StoredTransaction, b: StoredTransaction) => {
  const ca = a.createdAt ?? "", cb = b.createdAt ?? "";
  return ca !== cb ? (ca < cb ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
const latest = (rows: StoredTransaction[]) => [...rows].sort(byCreation)[rows.length - 1];
const recordId = (key: string, rows: StoredTransaction[]) => fingerprint({ kind: "correction", key, rows: rows.map((t) => t.id).sort() });

/**
 * Settles concurrent corrections in a merged copy. `localIds`/`serverIds`: the
 * transaction ids each side held before the merge. `at`: the merge's instant,
 * stamped on what it sets aside.
 */
export function settleConcurrentCorrections(
  data: LocalFinancials, localIds: ReadonlySet<string>, serverIds: ReadonlySet<string>, at: string,
): { data: LocalFinancials; clashes: CorrectionClash[] } {
  const txs = data.transactions ?? [];
  const live = txs.filter((t) => t.deletedAt == null && t.purgedAt == null);
  const onlyLocal = (t: StoredTransaction) => localIds.has(t.id) && !serverIds.has(t.id);
  const onlyServer = (t: StoredTransaction) => serverIds.has(t.id) && !localIds.has(t.id);
  const closeRows = new Set((data.periodCloses ?? []).flatMap((c) => [
    ...(c.emergencyFund?.transactionId ? [c.emergencyFund.transactionId] : []),
    ...(c.debts ?? []).flatMap((x) => (x.transactionId ? [x.transactionId] : [])),
  ]));

  const clashes: CorrectionClash[] = [];
  const setAside = new Set<string>();
  for (const a of accountsOf(data)) {
    const fixes = live.filter((t) => isCorrectionFor(t, a.test));
    const fixL = fixes.filter(onlyLocal), fixS = fixes.filter(onlyServer);
    const base = { kind: "correction" as const, account: a.account, key: a.key, name: a.name, currency: a.currency };

    if (fixL.length > 0 && fixS.length > 0) {
      const group = [...fixL, ...fixS];
      const kept = latest(group);
      const keptLocal = fixL.includes(kept);
      const others = keptLocal ? fixS : fixL;
      const keptValue = statedOf(kept), otherValue = statedOf(latest(others));
      if (group.some((t) => closeRows.has(t.id))) {
        clashes.push({ ...base, how: "close", kept: keptValue, other: otherValue, result: a.balance(data), id: recordId(a.key, group) });
        continue;
      }
      for (const t of others) setAside.add(t.id);
      const same = keptValue != null && keptValue === otherValue;
      clashes.push({ ...base, how: same ? "same" : "later", kept: keptValue, other: otherValue, id: recordId(a.key, group) });
      continue;
    }

    const movesL = live.filter((t) => a.moves(t) && !isCorrectionFor(t, a.test) && onlyLocal(t));
    const movesS = live.filter((t) => a.moves(t) && !isCorrectionFor(t, a.test) && onlyServer(t));
    const crossing = fixL.length > 0 && movesS.length > 0 ? { fix: fixL, moves: movesS }
      : fixS.length > 0 && movesL.length > 0 ? { fix: fixS, moves: movesL } : null;
    if (crossing) {
      const result = a.balance(data);
      const ids = new Set(crossing.moves.map((t) => t.id));
      const without = a.balance({ ...data, transactions: txs.filter((t) => !ids.has(t.id)) });
      // Movements that cancel out leave exactly what the correction stated: nothing to report.
      if (roundMoney(result - without) === 0) continue;
      // Each movement's own effect: the balance with every row, minus without that one.
      const effects = crossing.moves.map((m) => roundMoney(result - a.balance({ ...data, transactions: txs.filter((t) => t.id !== m.id) })));
      const movedDirection = effects.every((e) => e > 0) ? "up" : effects.every((e) => e < 0) ? "down" : "mixed";
      clashes.push({
        ...base, how: "crossed", kept: statedOf(latest(crossing.fix)), other: null,
        moved: roundMoney(result - without), movedCount: crossing.moves.length, movedDirection,
        result, id: recordId(a.key, [...crossing.fix, ...crossing.moves]),
      });
    }
  }

  if (setAside.size === 0) return { data, clashes };
  return { data: { ...data, transactions: txs.map((t) => (setAside.has(t.id) ? softDelete(data, t, at) : t)) }, clashes };
}
