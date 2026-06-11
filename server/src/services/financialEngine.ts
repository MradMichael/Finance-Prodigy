/**
 * MOMENTUM — Financial Engine
 * ---------------------------------------------------------------
 * Pure functions only: no I/O, no Prisma, no Date.now() hidden
 * inside calculations (clock is always injected). This is the
 * layer to unit-test exhaustively — routes stay thin.
 */

// ---------------------------------------------------------------- //
// Shared helpers
// ---------------------------------------------------------------- //

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Whole calendar months from `from` to `to` (min 0). */
export function monthsBetween(from: Date, to: Date): number {
  return Math.max(
    0,
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  );
}

/** DD-MM-YYYY — house display format. */
export function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

// ---------------------------------------------------------------- //
// 1) Debt payoff simulation — Snowball / Avalanche
// ---------------------------------------------------------------- //

export interface DebtInput {
  id: number;
  name: string;
  balance: number;
  aprPct: number;          // annual rate, e.g. 24.9
  minimumPayment: number;
}

export interface PayoffPlan {
  strategy: "SNOWBALL" | "AVALANCHE";
  feasible: boolean;
  months: number;
  debtFreeDate: string | null;        // ISO
  debtFreeDateDisplay: string | null; // DD-MM-YYYY
  totalInterest: number;
  totalPaid: number;
  monthlyCommitment: number;          // Σ minimums + extra
  payoffOrder: { id: number; name: string; month: number; date: string }[];
  /** Month-by-month total balance — feeds the projection chart. */
  schedule: { month: number; date: string; balance: number }[];
  warning?: string;
}

/**
 * Simulates monthly amortization. The monthly commitment stays CONSTANT
 * (Σ original minimums + extra): when a debt closes, its freed minimum
 * automatically rolls into the next target — the rollover effect that
 * makes both strategies accelerate over time.
 *
 *   SNOWBALL  → targets sorted by smallest balance (quick wins)
 *   AVALANCHE → targets sorted by highest APR (least total interest)
 */
export function simulateDebtPayoff(
  debts: DebtInput[],
  extraMonthly = 0,
  strategy: "SNOWBALL" | "AVALANCHE" = "AVALANCHE",
  start: Date = new Date()
): PayoffPlan {
  const live = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ ...d, paid: false }));

  const monthlyCommitment = round2(
    debts.reduce((s, d) => s + d.minimumPayment, 0) + extraMonthly
  );

  const base: PayoffPlan = {
    strategy, feasible: true, months: 0,
    debtFreeDate: start.toISOString(), debtFreeDateDisplay: fmtDate(start),
    totalInterest: 0, totalPaid: 0, monthlyCommitment,
    payoffOrder: [], schedule: [],
  };
  if (live.length === 0) return base;

  // Feasibility: commitment must beat month-one interest accrual.
  const firstInterest = live.reduce((s, d) => s + (d.balance * d.aprPct) / 1200, 0);
  if (monthlyCommitment <= firstInterest) {
    return {
      ...base, feasible: false, months: -1,
      debtFreeDate: null, debtFreeDateDisplay: null,
      warning: "Current payments don't cover monthly interest — balances would grow. Increase the monthly commitment or renegotiate rates.",
    };
  }

  const sorter =
    strategy === "SNOWBALL"
      ? (a: DebtInput, b: DebtInput) => a.balance - b.balance
      : (a: DebtInput, b: DebtInput) => b.aprPct - a.aprPct;

  let month = 0;
  let totalInterest = 0;
  let totalPaid = 0;
  const payoffOrder: PayoffPlan["payoffOrder"] = [];
  const schedule: PayoffPlan["schedule"] = [
    { month: 0, date: start.toISOString(), balance: round2(live.reduce((s, d) => s + d.balance, 0)) },
  ];

  while (live.some((d) => d.balance > 0.005) && month < 600) {
    month++;
    let budget = monthlyCommitment;

    // 1. Accrue interest on every open balance
    for (const d of live) {
      if (d.balance <= 0) continue;
      const interest = (d.balance * d.aprPct) / 1200;
      d.balance += interest;
      totalInterest += interest;
    }

    // 2. Minimums first (capped at remaining balance)
    for (const d of live) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.minimumPayment, d.balance);
      d.balance -= pay;
      budget -= pay;
      totalPaid += pay;
    }

    // 3. Everything left attacks the targets in strategy order,
    //    cascading to the next debt if one closes mid-month.
    const targets = live.filter((d) => d.balance > 0).sort(sorter);
    for (const d of targets) {
      if (budget <= 0) break;
      const pay = Math.min(budget, d.balance);
      d.balance -= pay;
      budget -= pay;
      totalPaid += pay;
    }

    // 4. Record payoffs
    const when = addMonths(start, month);
    for (const d of live) {
      if (d.balance <= 0.005 && !d.paid) {
        d.paid = true;
        d.balance = 0;
        payoffOrder.push({ id: d.id, name: d.name, month, date: when.toISOString() });
      }
    }

    schedule.push({
      month,
      date: when.toISOString(),
      balance: round2(live.reduce((s, d) => s + d.balance, 0)),
    });
  }

  const freeDate = addMonths(start, month);
  return {
    ...base,
    months: month,
    debtFreeDate: freeDate.toISOString(),
    debtFreeDateDisplay: fmtDate(freeDate),
    totalInterest: round2(totalInterest),
    totalPaid: round2(totalPaid),
    payoffOrder,
    schedule,
  };
}

// ---------------------------------------------------------------- //
// 2) Goal projection
// ---------------------------------------------------------------- //

export interface GoalProjection {
  pctComplete: number;       // 0–100
  monthsRemaining: number;
  requiredMonthly: number;   // to land exactly on targetDate
  paceRatio: number;         // actual progress ÷ expected-by-now (1 = on track)
  onTrack: boolean;
  targetDateDisplay: string;
}

export function projectGoal(
  goal: { targetAmount: number; currentAmount: number; targetDate: Date; createdAt: Date },
  now: Date = new Date()
): GoalProjection {
  const monthsRemaining = Math.max(1, monthsBetween(now, goal.targetDate));
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
  const pctComplete = goal.targetAmount > 0
    ? Math.min(100, round2((goal.currentAmount / goal.targetAmount) * 100))
    : 100;

  const totalSpan = Math.max(1, monthsBetween(goal.createdAt, goal.targetDate));
  const elapsed = Math.min(totalSpan, monthsBetween(goal.createdAt, now));
  const expectedPct = (elapsed / totalSpan) * 100;
  const paceRatio = expectedPct > 0 ? round2(pctComplete / expectedPct) : 1;

  return {
    pctComplete,
    monthsRemaining,
    requiredMonthly: round2(remaining / monthsRemaining),
    paceRatio,
    onTrack: paceRatio >= 0.9 || pctComplete >= 100,
    targetDateDisplay: fmtDate(goal.targetDate),
  };
}

// ---------------------------------------------------------------- //
// 3) Emergency fund
// ---------------------------------------------------------------- //

export interface EmergencyFundStatus {
  essentialMonthly: number;
  targetMonths: number;
  targetAmount: number;
  balance: number;
  coverageMonths: number;
  pctFunded: number;       // 0–100
  remaining: number;
}

export function emergencyFundStatus(
  balance: number,
  essentialMonthly: number,
  targetMonths: number
): EmergencyFundStatus {
  const targetAmount = round2(essentialMonthly * targetMonths);
  const coverageMonths = essentialMonthly > 0 ? round2(balance / essentialMonthly) : 0;
  return {
    essentialMonthly: round2(essentialMonthly),
    targetMonths,
    targetAmount,
    balance: round2(balance),
    coverageMonths,
    pctFunded: targetAmount > 0 ? Math.min(100, round2((balance / targetAmount) * 100)) : 100,
    remaining: Math.max(0, round2(targetAmount - balance)),
  };
}

// ---------------------------------------------------------------- //
// 4) Financial Health Score (0–100)
// ---------------------------------------------------------------- //
// Five weighted components. Each scores 0–100 on its own scale, then
// the weighted sum is the headline number. Grades are deliberately
// encouraging — the floor is "Laying foundations", never "Poor".

export interface HealthScoreInput {
  monthlyIncome: number;
  needsSpend: number;
  wantsSpend: number;
  savingsContrib: number;     // savings bucket outflow this month
  efPctFunded: number;        // 0–100
  monthlyDebtPayments: number;
  goalPaceRatios: number[];   // paceRatio per active goal
}

export interface HealthScore {
  score: number;
  grade: string;
  components: { key: string; label: string; score: number; weight: number; detail: string }[];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

export function calculateHealthScore(i: HealthScoreInput): HealthScore {
  const income = Math.max(1, i.monthlyIncome);

  // Savings rate vs the 20% target
  const savingsRate = i.savingsContrib / income;
  const savings = clamp((savingsRate / 0.2) * 100);

  // Needs discipline: ≤50% is perfect, linearly fades to 0 at 75%
  const needsRatio = i.needsSpend / income;
  const needs = needsRatio <= 0.5 ? 100 : clamp(((0.75 - needsRatio) / 0.25) * 100);

  // Emergency fund coverage
  const ef = clamp(i.efPctFunded);

  // Debt pressure: payments ≤10% of income is perfect, ≥40% scores 0
  const dti = i.monthlyDebtPayments / income;
  const debt = dti <= 0.1 ? 100 : clamp(((0.4 - dti) / 0.3) * 100);

  // Goal momentum: average pace across active goals (no goals = neutral 70)
  const pace = i.goalPaceRatios.length
    ? clamp((i.goalPaceRatios.reduce((s, r) => s + Math.min(r, 1.5), 0) / i.goalPaceRatios.length) * 100 / 1.0)
    : 70;

  const components = [
    { key: "savings", label: "Savings rate",      score: Math.round(savings), weight: 25, detail: `${(savingsRate * 100).toFixed(0)}% of income saved (target 20%)` },
    { key: "needs",   label: "Needs discipline",  score: Math.round(needs),   weight: 20, detail: `Essentials take ${(needsRatio * 100).toFixed(0)}% of income (target ≤50%)` },
    { key: "ef",      label: "Safety net",        score: Math.round(ef),      weight: 25, detail: `Emergency fund ${i.efPctFunded.toFixed(0)}% funded` },
    { key: "debt",    label: "Debt pressure",     score: Math.round(debt),    weight: 20, detail: `Debt payments are ${(dti * 100).toFixed(0)}% of income` },
    { key: "goals",   label: "Goal momentum",     score: Math.round(pace),    weight: 10, detail: i.goalPaceRatios.length ? "Average pace across active goals" : "No active goals yet" },
  ];

  const score = Math.round(components.reduce((s, c) => s + (c.score * c.weight) / 100, 0));
  const grade =
    score >= 80 ? "Thriving" :
    score >= 65 ? "Building momentum" :
    score >= 50 ? "Finding footing" : "Laying foundations";

  return { score, grade, components };
}

// ---------------------------------------------------------------- //
// 5) Encouragement engine — progress over deficits, always.
// ---------------------------------------------------------------- //

export interface EncouragementCtx {
  health: HealthScore;
  ef: EmergencyFundStatus;
  debtPlan?: PayoffPlan;
  goals: { name: string; projection: GoalProjection }[];
  savingsRatePct: number;
}

export function buildEncouragements(ctx: EncouragementCtx): string[] {
  const out: string[] = [];

  if (ctx.ef.pctFunded >= 100) out.push(`Safety net fully funded — ${ctx.ef.targetMonths} months of calm, banked.`);
  else if (ctx.ef.pctFunded >= 50) out.push(`Your safety net is ${ctx.ef.pctFunded.toFixed(0)}% built. Past halfway — the rest is downhill.`);
  else if (ctx.ef.balance > 0) out.push(`${ctx.ef.coverageMonths.toFixed(1)} months of cover already set aside. Every deposit buys breathing room.`);

  if (ctx.debtPlan?.feasible && ctx.debtPlan.months > 0) {
    out.push(`Stay the course and you're debt-free by ${ctx.debtPlan.debtFreeDateDisplay} — the date is already on the calendar.`);
  }

  for (const g of ctx.goals) {
    if (g.projection.pctComplete >= 100) out.push(`${g.name}: funded. Time to enjoy it.`);
    else if (g.projection.onTrack) out.push(`${g.name} is on pace — ${g.projection.pctComplete.toFixed(0)}% there.`);
  }

  if (ctx.savingsRatePct >= 20) out.push(`Saving ${ctx.savingsRatePct.toFixed(0)}% of income this month — above the 20% benchmark.`);

  if (out.length === 0) {
    out.push("You're tracking every dollar — that alone puts you ahead. The numbers improve from here.");
  }
  return out.slice(0, 3);
}
