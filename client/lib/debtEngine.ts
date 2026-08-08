/**
 * Debt payoff simulation — Snowball vs Avalanche, run client-side so the
 * comparison can be shown without a server round trip. Referentially
 * transparent (same inputs always produce the same output) but not
 * side-effect-free in the literal sense: simulateDebtPayoff below keeps a
 * small in-memory result cache, since it's called from computeDashboard()
 * on every keystroke in the UI (any field edit re-derives the whole
 * dashboard) and this is by far the most expensive computation in that
 * path — up to 600 month-iterations, twice (AVALANCHE + SNOWBALL), for a
 * field edit (e.g. the account name) that didn't change anything the
 * simulation actually depends on. Originally ported from a server-side
 * financial engine that has since been removed (it was unreachable — the
 * client never called it); this is now the only implementation.
 */

export interface DebtInput {
  id: string;
  name: string;
  balance: number;
  aprPct: number;
  minimumPayment: number;
}

export interface PayoffPlan {
  strategy: "SNOWBALL" | "AVALANCHE";
  feasible: boolean;
  months: number;
  debtFreeDate: string | null;
  totalInterest: number;
  monthlyCommitment: number;
  warning?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Clamp to the target month's actual last day instead of letting
// Date.setMonth overflow into the following month — the same bug already
// fixed in localData.ts's nextOccurrence: a naive d.setMonth(d.getMonth()+1)
// on Jan 31 lands on March 3 (Feb only has 28/29 days), which would show a
// debt-free date a full month later than it actually is.
export function addMonths(date: Date, months: number): Date {
  const targetDay = date.getDate();
  const candidate = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const daysInTargetMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
  candidate.setDate(Math.min(targetDay, daysInTargetMonth));
  candidate.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  return candidate;
}

/**
 * Simulates monthly amortization. The monthly commitment stays CONSTANT
 * (sum of original minimums + extra): when a debt closes, its freed
 * minimum automatically rolls into the next target — the rollover effect
 * that makes both strategies accelerate over time.
 *
 *   SNOWBALL  → targets sorted by smallest balance (quick wins)
 *   AVALANCHE → targets sorted by highest APR (least total interest)
 */
function runSimulation(
  debts: DebtInput[],
  extraMonthly: number,
  strategy: "SNOWBALL" | "AVALANCHE",
  start: Date,
): PayoffPlan {
  const live = debts.filter((d) => d.balance > 0).map((d) => ({ ...d, paid: false }));
  // Sum only debts still owed — a caller can pass already-paid-off debts
  // (balance 0, kept for history) whose minimumPayment wasn't cleared, and
  // those shouldn't count toward a monthly commitment that no longer exists.
  const monthlyCommitment = round2(live.reduce((s, d) => s + d.minimumPayment, 0) + extraMonthly);

  const base: PayoffPlan = {
    strategy, feasible: true, months: 0,
    debtFreeDate: start.toISOString(),
    totalInterest: 0, monthlyCommitment,
  };
  if (live.length === 0) return base;

  const firstInterest = live.reduce((s, d) => s + (d.balance * d.aprPct) / 1200, 0);
  if (monthlyCommitment <= firstInterest) {
    return {
      ...base, feasible: false, months: -1, debtFreeDate: null,
      warning: "Current payments don't cover monthly interest. Balances would grow.",
    };
  }

  const sorter =
    strategy === "SNOWBALL"
      ? (a: DebtInput, b: DebtInput) => a.balance - b.balance
      : (a: DebtInput, b: DebtInput) => b.aprPct - a.aprPct;

  // AVALANCHE sorts by aprPct, which is static for the whole simulation —
  // sort once up front instead of re-sorting on every one of up to 600
  // month-iterations. SNOWBALL sorts by balance, which genuinely changes
  // every month, so it still needs a fresh sort each pass.
  const staticOrder = strategy === "AVALANCHE";
  if (staticOrder) live.sort(sorter);

  let month = 0;
  let totalInterest = 0;

  while (live.some((d) => d.balance > 0.005) && month < 600) {
    month++;
    let budget = monthlyCommitment;

    for (const d of live) {
      if (d.balance <= 0) continue;
      const interest = (d.balance * d.aprPct) / 1200;
      d.balance += interest;
      totalInterest += interest;
    }

    for (const d of live) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.minimumPayment, d.balance);
      d.balance -= pay;
      budget -= pay;
    }

    // AVALANCHE: `live` is already APR-sorted and filter() preserves order,
    // so no re-sort needed. SNOWBALL: balances shift every month, so this
    // genuinely needs a fresh sort each pass.
    const targets = staticOrder
      ? live.filter((d) => d.balance > 0)
      : live.filter((d) => d.balance > 0).sort(sorter);
    for (const d of targets) {
      if (budget <= 0) break;
      const pay = Math.min(budget, d.balance);
      d.balance -= pay;
      budget -= pay;
    }

    for (const d of live) {
      if (d.balance <= 0.005) d.balance = 0;
    }
  }

  // The loop above can also exit because the 600-month cap was hit, not
  // because every debt actually reached zero — a commitment that's only
  // marginally above interest amortizes so slowly it never finishes within
  // 50 years. Reporting feasible:true with a concrete "debt-free" date in
  // that case would be presenting a wrong payoff date as a real one.
  if (live.some((d) => d.balance > 0)) {
    return {
      ...base, feasible: false, months: -1, debtFreeDate: null,
      warning: "This payment amount is too slow to project a payoff date within 50 years. Try increasing the monthly commitment.",
    };
  }

  return {
    ...base,
    months: month,
    debtFreeDate: addMonths(start, month).toISOString(),
    totalInterest: round2(totalInterest),
  };
}

// Small MRU cache — a handful of recent (strategy, inputs) combinations is
// enough to absorb "user is editing an unrelated field" without the
// simulation re-running, while staying bounded (no unbounded growth across
// a long session).
const CACHE_SIZE = 8;
const cache: { key: string; result: PayoffPlan }[] = [];

function fingerprint(debts: DebtInput[], extraMonthly: number, strategy: string, start: Date): string {
  // Only the fields runSimulation actually reads. Day-granularity (not full
  // ISO/time) is deliberate: the only consumer of debtFreeDate is dateFmt(),
  // which formats DD-MM-YYYY and drops time-of-day, so two calls within the
  // same calendar day always produce an identical displayed result anyway.
  const debtsKey = debts.map((d) => `${d.id}:${round2(d.balance)}:${d.aprPct}:${d.minimumPayment}`).join("|");
  const dayKey = start.toISOString().slice(0, 10);
  return `${strategy}|${dayKey}|${round2(extraMonthly)}|${debtsKey}`;
}

export function simulateDebtPayoff(
  debts: DebtInput[],
  extraMonthly = 0,
  strategy: "SNOWBALL" | "AVALANCHE" = "AVALANCHE",
  start: Date = new Date(),
): PayoffPlan {
  const key = fingerprint(debts, extraMonthly, strategy, start);
  const hit = cache.find((e) => e.key === key);
  if (hit) return hit.result;

  const result = runSimulation(debts, extraMonthly, strategy, start);
  cache.unshift({ key, result });
  if (cache.length > CACHE_SIZE) cache.length = CACHE_SIZE;
  return result;
}
