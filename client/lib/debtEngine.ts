/**
 * Debt payoff simulation — Snowball vs Avalanche, run client-side so the
 * comparison can be shown without a server round trip. Pure functions,
 * no I/O — mirrors server/src/services/financialEngine.ts's
 * simulateDebtPayoff (kept independent since the client and server are
 * separately deployable, but the algorithm should stay identical).
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

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
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
export function simulateDebtPayoff(
  debts: DebtInput[],
  extraMonthly = 0,
  strategy: "SNOWBALL" | "AVALANCHE" = "AVALANCHE",
  start: Date = new Date(),
): PayoffPlan {
  const live = debts.filter((d) => d.balance > 0).map((d) => ({ ...d, paid: false }));
  const monthlyCommitment = round2(debts.reduce((s, d) => s + d.minimumPayment, 0) + extraMonthly);

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
      warning: "Current payments don't cover monthly interest — balances would grow.",
    };
  }

  const sorter =
    strategy === "SNOWBALL"
      ? (a: DebtInput, b: DebtInput) => a.balance - b.balance
      : (a: DebtInput, b: DebtInput) => b.aprPct - a.aprPct;

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

    const targets = live.filter((d) => d.balance > 0).sort(sorter);
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

  return {
    ...base,
    months: month,
    debtFreeDate: addMonths(start, month).toISOString(),
    totalInterest: round2(totalInterest),
  };
}
