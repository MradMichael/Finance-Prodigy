import type { LocalFinancials, BudgetRuleKey } from "./localData";
import { monthlyEquivalent, nextOccurrence, BUDGET_RULES, valueForMonth, budgetPctForMonth, toUSD as toUSDShared } from "./localData";
import { simulateDebtPayoff, type DebtInput } from "./debtEngine";

interface Projection {
  pctComplete: number; monthsRemaining: number; requiredMonthly: number;
  paceRatio: number; onTrack: boolean; targetDateDisplay: string;
}

export interface DashboardPayload {
  user: { name: string; currency: string; payoffStrategy: "SNOWBALL" | "AVALANCHE" };
  period: { year: number; month: number };
  /** Any transaction ever logged, not scoped to this month — distinct from month.totalSpend, which also counts pro-rated recurring payments even when nothing's actually been logged. */
  hasLoggedTransactions: boolean;
  budgetRule: BudgetRuleKey;
  /** Resolved needs/wants/savings percentages (sum to 100) for THIS month, as currently configured — snapshotted by the caller into budgetRuleHistory so past months can be judged against the split that was actually in effect then. */
  budgetTargetPct: { needs: number; wants: number; savings: number };
  budgetTargets: { needs: number; wants: number; savings: number };
  budgetRollover: { needs: number; wants: number; savings: number };
  /** budgetTargets + budgetRollover, floored at 0 — what BucketRow/budgetPace actually judge spend against. */
  effectiveBudgetTargets: { needs: number; wants: number; savings: number };
  budgetPace: {
    bucket: "NEEDS" | "WANTS" | "SAVINGS"; label: string;
    pctOfMonthElapsed: number; pctOfBudgetUsed: number; projectedPct: number;
    status: "ok" | "watch" | "over"; message: string;
  }[];
  health: {
    score: number; grade: string;
    components: { key: string; label: string; score: number; weight: number; detail: string }[];
  };
  encouragements: string[];
  streaks: { key: string; label: string; count: number; message: string }[];
  month: {
    income: number; needsSpend: number; wantsSpend: number; savingsContrib: number;
    totalSpend: number; netCashFlow: number; savingsRatePct: number;
  };
  emergencyFund: {
    targetMonths: number; targetAmount: number; balance: number;
    coverageMonths: number; pctFunded: number; remaining: number;
  };
  debt: {
    totalBalance: number; count: number;
    plan: {
      feasible: boolean; months: number; debtFreeDateDisplay: string | null;
      totalInterest: number; monthlyCommitment: number; warning?: string;
    } | null;
    comparison: {
      snowball: { feasible: boolean; months: number; totalInterest: number; debtFreeDateDisplay: string | null };
      avalanche: { feasible: boolean; months: number; totalInterest: number; debtFreeDateDisplay: string | null };
      avalancheSavesVsSnowball: number;
    } | null;
  };
  goals: {
    id: number; name: string; emoji: string | null; type: string;
    targetAmount: number; currentAmount: number; projection: Projection;
  }[];
  sixMonthTrend: { ymKey: number; income: number; spend: number }[];
  netWorthTrend: { ym: string; value: number }[];
  upcomingRenewals: {
    id: string; name: string; emoji: string; amount: number; currency: string;
    dueDate: string; dueInDays: number;
  }[];
  balanceChecks: {
    id: string; name: string; currency: string;
    /** expected/actual/discrepancy are normalized to USD, like every other cross-cutting total in this payload — `currency` is the balance's own native currency, kept for display labeling only. */
    expected: number;
    actual: number | null; actualDate: string | null;
    discrepancy: number | null; // actual - expected, when actual is known
  }[];
  netWorth: {
    assets: number;
    liabilities: number;
    total: number;
    tier: string;
    tierColor: "jade" | "brass" | "coral" | "mute";
    suggestions: string[];
  };
}

export function dateFmt(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

export function computeDashboard(data: LocalFinancials): DashboardPayload {
  // Normalize arrays so partial objects from sync/patch never crash
  data = {
    ...data,
    transactions:     data.transactions     ?? [],
    goals:            data.goals            ?? [],
    debts:            data.debts            ?? [],
    recurring:        data.recurring        ?? [],
    cards:            data.cards            ?? [],
    assets:           data.assets           ?? [],
    trackedBalances:  data.trackedBalances  ?? [],
    netWorthHistory:  data.netWorthHistory  ?? [],
  };

  const now = new Date();
  const year = now.getFullYear();

  // ── Budget rule targets ──────────────────────────────────────────
  const ruleKey: BudgetRuleKey = data.budgetRule ?? "50-30-20";
  const baseRule = BUDGET_RULES[ruleKey];
  const budgetTargetPct = ruleKey === "custom"
    ? {
        needs:   data.budgetCustomNeeds   ?? 50,
        wants:   data.budgetCustomWants   ?? 30,
        savings: 100 - (data.budgetCustomNeeds ?? 50) - (data.budgetCustomWants ?? 30),
      }
    : { needs: baseRule.needs, wants: baseRule.wants, savings: baseRule.savings };
  const month = now.getMonth() + 1;
  const prefix = `${year}-${String(month).padStart(2, "0")}`;

  // Same historized-lookup pattern as incomeForMonth/toUSDForMonth, for the
  // budget-rule split — otherwise changing your budget rule today silently
  // rewrites which past months' rollover/savings-streak judged themselves
  // against, using a target they were never actually held to at the time.
  const budgetTargetPctForMonth = (ym: string) => budgetPctForMonth(data.budgetRuleHistory, ym, budgetTargetPct);

  const lbpRate = data.lbpRate ?? 89500;
  const toUSD = (amount: number, currency?: string) => toUSDShared(amount, currency as "USD" | "LBP" | undefined, lbpRate);

  // For judging a PAST month: use the income/LBP-rate/budget-rule that were
  // actually in effect that month, not whatever they are today. A raise, an
  // updated exchange rate (LBP is volatile enough that this happens often),
  // or a budget-rule change would otherwise silently rewrite what past
  // months looked like every time this recomputes. Falls back to the
  // current value for months before any history was recorded (accounts
  // predating this, or genuinely the first month), so this only improves
  // accuracy going forward, not retroactively.
  // Raw (unfloored) like the current-month income/incomeSafe split below —
  // display sites (e.g. sixMonthTrend) use this directly; only the one
  // division site (the savings-streak check) needs the floored version.
  const toUSDForMonth = (amount: number, currency: string | undefined, ym: string) =>
    currency === "LBP" ? amount / valueForMonth(data.lbpRateHistory, ym, lbpRate) : amount;
  // Base salary for that month plus any one-off INCOME transactions logged
  // in it (a gift, a reimbursement) -- both are real money that month, so
  // "effective income" for every downstream ratio/target/trend should
  // reflect both, not just the fixed Setup figure. No caller of
  // incomeForMonth wants the un-boosted salary alone, so this is folded in
  // at the source instead of threading a second figure through every site.
  const incomeTxForMonth = (ym: string) => (data.transactions ?? [])
    .filter((t) => t.date.startsWith(ym) && t.bucket === "INCOME")
    .reduce((s, t) => s + toUSDForMonth(t.amount, t.currency, ym), 0);
  const incomeForMonth = (ym: string) => valueForMonth(data.incomeHistory, ym, data.income) + incomeTxForMonth(ym);
  const incomeForMonthSafe = (ym: string) => Math.max(incomeForMonth(ym), 1);

  const monthTx = (data.transactions ?? []).filter((t) => t.date.startsWith(prefix));

  // Recurring contributions this month (pro-rated by frequency, converted to USD)
  const activeRecurring = (data.recurring ?? []);
  const recurNeeds   = activeRecurring.filter((r) => r.bucket === "NEEDS").reduce((s, r)   => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);
  const recurWants   = activeRecurring.filter((r) => r.bucket === "WANTS").reduce((s, r)   => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);
  const recurSavings = activeRecurring.filter((r) => r.bucket === "SAVINGS").reduce((s, r) => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);

  const needsSpend  = monthTx.filter((t) => t.bucket === "NEEDS").reduce((s, t) => s + toUSD(t.amount, t.currency), 0)   + recurNeeds;
  const wantsSpend  = monthTx.filter((t) => t.bucket === "WANTS").reduce((s, t) => s + toUSD(t.amount, t.currency), 0)   + recurWants;
  const savingsContrib = monthTx.filter((t) => t.bucket === "SAVINGS").reduce((s, t) => s + toUSD(t.amount, t.currency), 0) + recurSavings;
  const totalSpend  = needsSpend + wantsSpend + savingsContrib;
  // One-off INCOME transactions this month (a gift, a reimbursement) — real
  // money on top of the fixed Setup salary, so it belongs in `income`
  // itself rather than a side figure only some callers remember to add.
  const incomeTx = monthTx.filter((t) => t.bucket === "INCOME").reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
  // `income` stays the RAW stored value (+ any logged income transactions)
  // everywhere it's displayed or used as a multiplier (month.income,
  // netCashFlow, budget targets) so a fresh $0-income account reads as $0,
  // not a phantom $1. `incomeSafe` exists only to keep the ratio
  // calculations below from dividing by zero.
  const income      = data.income + incomeTx;
  const incomeSafe  = Math.max(income, 1); // guard div-by-zero (ratios only)
  const netCashFlow = income - totalSpend;
  const savingsRatePct = (savingsContrib / incomeSafe) * 100;

  // ── Health components ────────────────────────────────────────────
  const targetSavingsPct = budgetTargetPct.savings;
  const targetNeedsPct   = budgetTargetPct.needs / 100;
  const savingsScore = targetSavingsPct > 0 ? Math.min(100, (savingsRatePct / targetSavingsPct) * 100) : 100;
  const needsPct = needsSpend / incomeSafe;
  const needsScore = needsPct <= targetNeedsPct ? 100 : Math.max(0, 100 - (needsPct - targetNeedsPct) * 400);

  // Uses the BUDGETED needs allocation (income × needs%), not this month's
  // partial actual spend — needsSpend only reflects however many days have
  // elapsed so far (understating a typical month early on, or overstating
  // it once a lump-sum recurring bill lands — the same "partial month"
  // issue fixed in budgetPace below), so "how many months does my
  // emergency fund cover" would otherwise shift day to day for reasons
  // that have nothing to do with the fund itself. Falls back to the old
  // logic only when there's no income yet to budget against.
  const efMonthlyBase = income > 0 ? income * targetNeedsPct : (needsSpend || income * 0.5);
  const efTarget  = data.emergencyFundTargetMonths * efMonthlyBase;
  const efBalance = data.emergencyFundBalance;
  const efPct     = efTarget > 0 ? Math.min(100, (efBalance / efTarget) * 100) : 0;
  const efScore   = efPct;

  // Paid-off debts stay in the array (balance 0, paidOffAt set) for history —
  // their minPayment isn't cleared, so summing over all debts unfiltered
  // would keep counting a payment obligation that no longer exists.
  const totalMinPayments = data.debts.filter((d) => d.balance > 0).reduce((s, d) => s + d.minPayment, 0);
  const debtPressurePct  = totalMinPayments / incomeSafe;
  const debtScore = Math.max(0, 100 - debtPressurePct * 400);

  const goalScores = data.goals.map((g) => {
    const rem = g.targetAmount - g.currentAmount;
    if (rem <= 0) return 1;
    // Rounded the same way the `goals` array below computes its own `ms` for
    // the same goal — otherwise the two independently-computed paces can
    // drift by a hair and disagree right at a threshold (e.g. onTrack).
    const ms = Math.max(1, Math.round((new Date(g.targetDate).getTime() - now.getTime()) / (30.44 * 24 * 3600 * 1000)));
    const req = rem / ms;
    return req > 0 ? Math.min(2, savingsContrib / req) : 0.5;
  });
  const avgGoalPace = goalScores.length ? goalScores.reduce((s, v) => s + v, 0) / goalScores.length : 0.5;
  const goalScore   = Math.min(100, avgGoalPace * 100);

  const totalScore = Math.round(
    savingsScore * 0.25 + needsScore * 0.20 + efScore * 0.25 + debtScore * 0.20 + goalScore * 0.10,
  );
  const grade =
    totalScore >= 80 ? "Thriving"
    : totalScore >= 60 ? "Building momentum"
    : totalScore >= 40 ? "Gaining ground"
    : "Starting strong";

  // ── Encouragements ───────────────────────────────────────────────
  const enc: string[] = [];
  if (data.income === 0) {
    enc.push("Set your monthly income in the panel. That one number unlocks everything else.");
  } else if (savingsRatePct >= 20) {
    enc.push(`${savingsRatePct.toFixed(1)}% savings rate: you've cleared the 20% bar. Every extra dollar is compounding quietly in the background.`);
  } else if (savingsRatePct >= 10) {
    enc.push(`Saving ${savingsRatePct.toFixed(1)}% this month. You're ${(20 - savingsRatePct).toFixed(1)} points from the ideal 20%, closer than you think.`);
  } else if (savingsRatePct > 0) {
    enc.push(`${savingsRatePct.toFixed(1)}% saved this month. Small, but it's real. The habit matters more than the amount right now.`);
  }
  if (efPct >= 100) {
    enc.push("Safety net fully funded. You've built the buffer that lets you take smart risks.");
  } else if (efPct >= 50) {
    enc.push(`Safety net is ${Math.round(efPct)}% built and past halfway. The hard part is behind you.`);
  } else if (efPct > 0) {
    enc.push(`Safety net at ${Math.round(efPct)}%. Even a partial buffer changes how you handle surprises.`);
  }
  if (data.debts.length === 0 && data.income > 0) {
    enc.push("Zero debts. Every dollar you earn goes to your future, not your past.");
  } else if (debtPressurePct > 0.25) {
    enc.push(`Debt payments are ${Math.round(debtPressurePct * 100)}% of income, a priority worth attacking. Add extra payments in the debt section to see the timeline shrink.`);
  }
  if (enc.length === 0) {
    enc.push("Log your first transaction below. The picture sharpens quickly once data starts flowing in.");
  }

  // ── Debt plan (real per-debt amortization, not an average-APR estimate) ──
  const totalDebtBalance = data.debts.reduce((s, d) => s + d.balance, 0);
  let debtPlan = null;
  let debtComparison: DashboardPayload["debt"]["comparison"] = null;
  if (data.debts.length > 0 && totalDebtBalance > 0) {
    const extra = Math.max(0, netCashFlow * 0.3);
    const monthlyPayment = totalMinPayments + extra;
    const debtInputs: DebtInput[] = data.debts.map((d) => ({
      id: d.id, name: d.name, balance: d.balance, aprPct: d.apr, minimumPayment: d.minPayment,
    }));
    if (monthlyPayment > 0) {
      const chosen = simulateDebtPayoff(debtInputs, extra, "AVALANCHE", now);
      debtPlan = {
        feasible: chosen.feasible, months: chosen.months,
        debtFreeDateDisplay: chosen.debtFreeDate ? dateFmt(new Date(chosen.debtFreeDate)) : null,
        totalInterest: chosen.totalInterest,
        monthlyCommitment: Math.round(chosen.monthlyCommitment),
        ...(chosen.warning ? { warning: chosen.warning } : {}),
      };

      const snowball = simulateDebtPayoff(debtInputs, extra, "SNOWBALL", now);
      const avalanche = chosen;
      debtComparison = {
        snowball: { feasible: snowball.feasible, months: snowball.months, totalInterest: snowball.totalInterest, debtFreeDateDisplay: snowball.debtFreeDate ? dateFmt(new Date(snowball.debtFreeDate)) : null },
        avalanche: { feasible: avalanche.feasible, months: avalanche.months, totalInterest: avalanche.totalInterest, debtFreeDateDisplay: avalanche.debtFreeDate ? dateFmt(new Date(avalanche.debtFreeDate)) : null },
        avalancheSavesVsSnowball: Math.round((snowball.totalInterest - avalanche.totalInterest) * 100) / 100,
      };
    } else {
      debtPlan = { feasible: false, months: 0, debtFreeDateDisplay: null, totalInterest: 0, monthlyCommitment: 0, warning: "Monthly income is fully consumed by needs and wants. Try trimming wants to free up cash for debt." };
    }
  }

  // ── Goals ────────────────────────────────────────────────────────
  const goals = data.goals.map((g, i) => {
    const rem = Math.max(0, g.targetAmount - g.currentAmount);
    const td = new Date(g.targetDate);
    const rawMs = Math.round((td.getTime() - now.getTime()) / (30.44 * 24 * 3600 * 1000));
    const ms = Math.max(1, rawMs); // safe denominator for req below — never displayed directly
    const req = rem / ms;
    const pace = req > 0 ? Math.min(2, savingsContrib / req) : 1;
    return {
      id: i + 1, name: g.name, emoji: g.emoji || null, type: "SAVINGS",
      targetAmount: g.targetAmount, currentAmount: g.currentAmount,
      projection: {
        // targetAmount of exactly 0 (e.g. a goal saved before an amount was
        // entered) would otherwise divide 0/0 into NaN — treat it as met.
        pctComplete: g.targetAmount > 0 ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 100,
        // Raw (only floored at 0, not 1) — an overdue goal should read "0 mo
        // left", not the misleading "1 mo left" the div-by-zero-safe `ms`
        // above would otherwise leak into display.
        monthsRemaining: Math.max(0, rawMs),
        requiredMonthly: Math.round(req),
        paceRatio: Math.round(pace * 100) / 100,
        onTrack: pace >= 0.9,
        targetDateDisplay: dateFmt(td),
      },
    };
  });

  // ── Net worth ─────────────────────────────────────────────────────
  const nwAssets      = data.emergencyFundBalance
    + data.goals.reduce((s, g) => s + toUSD(g.currentAmount, undefined), 0)
    + data.assets.reduce((s, a) => s + toUSD(a.value, a.currency), 0);
  const nwLiabilities = totalDebtBalance;
  const nwTotal       = nwAssets - nwLiabilities;

  type NWColor = "jade" | "brass" | "coral" | "mute";
  // Sorted ascending by `max` (the upper bound each tier applies below);
  // the last row's `max` is Infinity so every net worth lands somewhere.
  const NET_WORTH_TIERS: { max: number; tier: string; tierColor: NWColor; suggestions: string[] }[] = [
    {
      max: -20000, tier: "Heavy debt load", tierColor: "coral",
      suggestions: [
        "Target the highest-APR debt first: that's where interest is burning fastest.",
        "Every dollar above the minimum payment is money that stops compounding against you.",
        "Even $50 extra per month cuts months off your payoff date. Run the numbers in Debts.",
      ],
    },
    {
      max: -5000, tier: "Rebuilding", tierColor: "coral",
      suggestions: [
        "You're climbing: the negative number is shrinking each month.",
        "Consider a small side income for 3–6 months; even $200/month accelerates this significantly.",
        "Once you clear the debt, redirect that minimum payment into savings automatically.",
      ],
    },
    {
      max: -1500, tier: "Closing the gap", tierColor: "brass",
      suggestions: [
        "You're within reach of zero. A few focused months can get you there.",
        "Direct any extra income straight at your smallest remaining debt to build momentum.",
        "You've already cut the deficit a lot. This is the home stretch, not the starting line.",
      ],
    },
    {
      max: 0, tier: "Almost positive", tierColor: "brass",
      suggestions: [
        "You're close to zero: that milestone shifts your psychology entirely.",
        "Focus on one debt at a time to cross into positive territory fast.",
        "Celebrate each debt closed: that freed cash is your first wealth-building tool.",
      ],
    },
    {
      max: 5000, tier: "Breaking even", tierColor: "brass",
      suggestions: [
        "Your liabilities are covered. Now every dollar saved is pure net worth growth.",
        "Start or grow your safety net: it's your first true asset.",
        "Set a goal to hit $5,000 in savings; that buffer changes how you handle surprises.",
      ],
    },
    {
      max: 25000, tier: "Foundation builder", tierColor: "jade",
      suggestions: [
        "You're ahead of most people your age. Keep the momentum going.",
        "Compound growth starts to matter here. Even modest returns on $10K make a difference.",
        "Consider diversifying: savings, goals, and if applicable, low-risk investments.",
      ],
    },
    {
      max: 100000, tier: "Growing wealth", tierColor: "jade",
      suggestions: [
        "Significant position: you have real financial resilience now.",
        "At this level, optimizing income is often more powerful than cutting expenses.",
        "Consider whether your money is working as hard as you are.",
      ],
    },
    {
      max: Infinity, tier: "Wealth building", tierColor: "jade",
      suggestions: [
        "Strong financial foundation. Protect it with diversification.",
        "Focus shifts from accumulation to optimization and preservation.",
        "Reinvesting returns rather than spending them is what separates this level from the next.",
      ],
    },
  ];
  const nwData = NET_WORTH_TIERS.find((t) => nwTotal < t.max)!;

  // ── Six-month trend ───────────────────────────────────────────────
  const sixMonthTrend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(year, month - 1 - (5 - i), 1);
    const ymKey = d.getFullYear() * 100 + (d.getMonth() + 1);
    const isCurrent = i === 5;
    const mo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const tx = data.transactions.filter((t) => t.date.startsWith(mo));
    // INCOME transactions aren't spend -- they're already folded into
    // moIncome below via incomeForMonth. Summing them here too would
    // inflate the spend line by exactly what should be inflating income.
    const txSpend = tx.filter((t) => t.bucket !== "INCOME").reduce((s, t) => s + toUSDForMonth(t.amount, t.currency, mo), 0);
    // Recurring payments (rent, subscriptions, etc.) don't create a
    // transaction row each month, so counting only logged transactions
    // understated every month's real spend — evaluate each recurring
    // item as of that historical month, same as the current-month totals do.
    // For the CURRENT month specifically, evaluate as of `now` (today),
    // matching the top-of-function totalSpend calc — using day-1 here too
    // would disagree with month.totalSpend for any item that starts/ends
    // partway through the current month.
    const recurAsOf = isCurrent ? now : d;
    const recurSpend = activeRecurring.reduce((s, r) => s + toUSDForMonth(monthlyEquivalent(r, recurAsOf), r.currency, mo), 0);
    const sp = txSpend + recurSpend;
    // Raw (unfloored) income for display, same reasoning as the current-
    // month income/incomeSafe split — a genuinely $0 past month should
    // read as $0 on the chart, not a phantom $1 from the div-by-zero guard.
    const moIncome = isCurrent ? income : incomeForMonth(mo);
    return { ymKey, income: isCurrent ? income : (sp > 0 ? moIncome : 0), spend: sp };
  });

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const ordinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  // ── Budget rollover — unspent (or overspent) carries into this month ──
  // Uses the income/LBP-rate/budget-rule that were actually in effect each
  // past month (via incomeForMonth/toUSDForMonth/budgetTargetPctForMonth)
  // rather than today's values — skips months with no real activity at all
  // (no logged transaction AND no active recurring item) so a blank month
  // before the account had any data doesn't distort the running total.
  // Computed before budget pace below so the pace warnings judge spend
  // against the same rollover-adjusted target the Budget screen displays,
  // instead of two different numbers.
  const budgetRollover = { needs: 0, wants: 0, savings: 0 };
  {
    const monthsBack = Math.min(11, month - 1); // back to January of this year, capped at 11
    for (let i = monthsBack; i >= 1; i--) {
      const d = new Date(year, month - 1 - i, 1);
      const ym = monthKey(d);
      const tx = data.transactions.filter((t) => t.date.startsWith(ym));
      const spend = { needs: 0, wants: 0, savings: 0 };
      for (const t of tx) {
        // INCOME transactions already boosted moIncome via incomeForMonth
        // below — counting them here too (the old catch-all landed anything
        // that wasn't NEEDS/WANTS in "savings") would double-count them as
        // both extra income AND extra savings rollover.
        if (t.bucket === "INCOME") continue;
        const amt = toUSDForMonth(t.amount, t.currency, ym);
        if (t.bucket === "NEEDS") spend.needs += amt;
        else if (t.bucket === "WANTS") spend.wants += amt;
        else spend.savings += amt;
      }
      // Recurring bills don't create a transaction row, so a past month's
      // real spend was understated (sometimes all the way to "skip this
      // month entirely" below) whenever nothing was also manually logged
      // that month — the same gap already handled for the *current*
      // month's needsSpend/wantsSpend/savingsContrib above.
      let recurActive = false;
      for (const r of activeRecurring) {
        const amt = toUSDForMonth(monthlyEquivalent(r, d), r.currency, ym);
        if (amt <= 0) continue;
        recurActive = true;
        if (r.bucket === "NEEDS") spend.needs += amt;
        else if (r.bucket === "WANTS") spend.wants += amt;
        else spend.savings += amt;
      }
      if (tx.length === 0 && !recurActive) continue;
      const moIncome = incomeForMonth(ym);
      const moTargetPct = budgetTargetPctForMonth(ym);
      budgetRollover.needs   += (moIncome * moTargetPct.needs   / 100) - spend.needs;
      budgetRollover.wants   += (moIncome * moTargetPct.wants   / 100) - spend.wants;
      budgetRollover.savings += (moIncome * moTargetPct.savings / 100) - spend.savings;
    }
  }

  // ── Budget pace — proactive "on track to exceed" warnings ──────────
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysElapsed = Math.max(1, now.getDate());
  const BUCKET_LABEL = { NEEDS: "Needs", WANTS: "Wants", SAVINGS: "Savings" } as const;
  const bucketSpend = { NEEDS: needsSpend, WANTS: wantsSpend, SAVINGS: savingsContrib };
  // Floored at 0 — a deficit rolling in from past months (or a 0%-allocated
  // bucket) should never push the *target itself* negative, which would
  // make "$0 spent" read as "over budget" and make every ratio nonsensical.
  const bucketTargetAmt = {
    NEEDS: Math.max(0, income * budgetTargetPct.needs / 100 + budgetRollover.needs),
    WANTS: Math.max(0, income * budgetTargetPct.wants / 100 + budgetRollover.wants),
    SAVINGS: Math.max(0, income * budgetTargetPct.savings / 100 + budgetRollover.savings),
  };
  // Projecting a full month's spend from only the first handful of days
  // grossly overreacts to ordinary lumpy spending (one grocery run, one
  // subscription renewal) — real report: $276 of Wants logged by day 8
  // read as "you'll exceed it by ~$610", a bigger overage than a bucket
  // that had already spent 90% of its budget, purely because day 8 of 31
  // is a 3.9x extrapolation multiplier on whatever happened to land early.
  // 10 days (roughly a third of a month) keeps that multiplier under 3.1x
  // and gives spending a few more data points to average out before a
  // specific dollar claim is made. Below this threshold, flag it lightly
  // without a specific dollar claim instead.
  const MIN_DAYS_FOR_PROJECTION = 10;
  // Recurring contributions (recurNeeds/recurWants/recurSavings) are already
  // each recurring item's full monthly-equivalent amount, not something that
  // accrues day-by-day — a $1,000 rent payment is "owed" in full from day 1,
  // not $32/day. Rate-projecting the combined (transactions + recurring)
  // total by daysInMonth/daysElapsed would re-multiply that already-full
  // recurring amount again, e.g. by ~3.9x on the 8th of a 31-day month. Only
  // the actual logged-transaction portion should be extrapolated; the
  // recurring portion gets added back in at its real, known, un-projected
  // value.
  const bucketRecur = { NEEDS: recurNeeds, WANTS: recurWants, SAVINGS: recurSavings };
  const budgetPace: DashboardPayload["budgetPace"] = (["NEEDS", "WANTS", "SAVINGS"] as const)
    .filter((b) => bucketTargetAmt[b] > 0)
    .map((b) => {
      const spend = bucketSpend[b];
      const target = bucketTargetAmt[b];
      const recurContrib = bucketRecur[b];
      const txSpend = spend - recurContrib;
      const projectedSpend = (txSpend / daysElapsed) * daysInMonth + recurContrib;
      const pctOfMonthElapsed = Math.round((daysElapsed / daysInMonth) * 100);
      const pctOfBudgetUsed = Math.round((spend / target) * 100);
      const projectedPct = Math.round((projectedSpend / target) * 100);
      const reliableProjection = daysElapsed >= MIN_DAYS_FOR_PROJECTION;

      if (b === "SAVINGS") {
        // Savings is a floor, not a ceiling — clearing it early is good news.
        const status = pctOfBudgetUsed >= 100 ? "ok" : "watch";
        const message = pctOfBudgetUsed >= 100
          ? `Savings target already met this month.`
          : reliableProjection
          ? `On pace for ${Math.max(0, projectedPct)}% of this month's savings target.`
          : `${pctOfBudgetUsed}% of this month's savings target met so far.`;
        return { bucket: b, label: BUCKET_LABEL[b], pctOfMonthElapsed, pctOfBudgetUsed, projectedPct, status, message };
      }

      let status: "ok" | "watch" | "over" = "ok";
      let message: string;
      if (spend >= target) {
        status = "over";
        message = `${BUCKET_LABEL[b]} budget is already used up, with ${Math.max(0, 100 - pctOfMonthElapsed)}% of the month left.`;
      } else if (projectedPct >= 100 && reliableProjection) {
        status = "watch";
        const overBy = Math.round(projectedSpend - target);
        message = `${pctOfBudgetUsed}% of ${BUCKET_LABEL[b]} budget spent and it's only the ${ordinal(daysElapsed)}. At this rate, you'll exceed it by ~$${overBy}.`;
      } else if (projectedPct >= 100) {
        status = "watch";
        message = `${pctOfBudgetUsed}% of ${BUCKET_LABEL[b]} budget spent already, this early in the month. Worth keeping an eye on.`;
      } else {
        message = `${BUCKET_LABEL[b]} spending is on pace (${pctOfBudgetUsed}% used, ${pctOfMonthElapsed}% of the month elapsed).`;
      }
      return { bucket: b, label: BUCKET_LABEL[b], pctOfMonthElapsed, pctOfBudgetUsed, projectedPct, status, message };
    });

  // ── Streaks ─────────────────────────────────────────────────────────
  let savingsStreak = 0;
  // Gated on targetSavingsPct alone, not today's income — each month below
  // already resolves its OWN historical income via incomeForMonthSafe, so a
  // real past streak shouldn't vanish just because CURRENT income happens
  // to be $0 (e.g. between jobs, or not yet re-entered after a reset).
  if (targetSavingsPct > 0) {
    for (let i = 1; i <= 12; i++) {
      const d = new Date(year, month - 1 - i, 1);
      const ym = monthKey(d);
      const tx = data.transactions.filter((t) => t.date.startsWith(ym));
      let monthSavings = tx.filter((t) => t.bucket === "SAVINGS").reduce((s, t) => s + toUSDForMonth(t.amount, t.currency, ym), 0);
      // Recurring bills don't create a transaction row, so a past month's
      // real savings contribution was understated (sometimes all the way to
      // "treat this as a blank month and end the streak" below) whenever
      // nothing was also manually logged that month — the same gap already
      // fixed in budgetRollover above.
      let recurActive = false;
      for (const r of activeRecurring) {
        if (r.bucket !== "SAVINGS") continue;
        const amt = toUSDForMonth(monthlyEquivalent(r, d), r.currency, ym);
        if (amt <= 0) continue;
        recurActive = true;
        monthSavings += amt;
      }
      if (tx.length === 0 && !recurActive) break;
      // Uses the budget-rule split that was actually in effect that month,
      // not today's — otherwise changing rules retroactively rewrites which
      // past months count toward the streak.
      const moTargetPct = budgetTargetPctForMonth(ym).savings;
      if ((monthSavings / incomeForMonthSafe(ym)) * 100 >= moTargetPct) savingsStreak++;
      else break;
    }
  }
  const streaks: DashboardPayload["streaks"] = [];
  if (savingsStreak >= 2) {
    streaks.push({
      key: "savings-streak", label: "Savings streak", count: savingsStreak,
      message: `🔥 ${savingsStreak} months in a row hitting your savings target.`,
    });
  }

  // ── Upcoming renewals ────────────────────────────────────────────────
  const RENEWAL_WINDOW_DAYS = 7;
  // Anchored at UTC midnight of today's LOCAL calendar date, matching
  // nextOccurrence's own basis: recurring startDate/endDate are date-only
  // strings ("YYYY-MM-DD"), which JS parses as UTC midnight, and
  // nextOccurrence (localData.ts) builds every occurrence it returns from
  // that same UTC-anchored arithmetic. Anchoring todayMidnight to LOCAL
  // midnight instead (as this used to) skews dueInDays by the user's UTC
  // offset — off by a day for anyone not at UTC+0, which is most of this
  // app's actual (Lebanon/MENA) audience.
  const todayMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const upcomingRenewals: DashboardPayload["upcomingRenewals"] = data.recurring
    .map((r) => {
      const next = nextOccurrence(r, now);
      if (!next) return null;
      const dueInDays = Math.round((next.getTime() - todayMidnight.getTime()) / (24 * 3600 * 1000));
      if (dueInDays < 0 || dueInDays > RENEWAL_WINDOW_DAYS) return null;
      return { id: r.id, name: r.name, emoji: r.emoji, amount: r.amount, currency: r.currency, dueDate: next.toISOString().slice(0, 10), dueInDays };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.dueInDays - b.dueInDays);

  // ── Balance reconciliation — "did I forget to log a payment?" ──────
  // Expected = starting balance minus every transaction on this payment
  // method since the starting date. Only sees the transaction ledger, so
  // debt payments and un-"extra"'d recurring charges aren't reflected —
  // a real gap, not a bug (see TrackedBalance's doc comment). Each
  // transaction converts at the LBP rate that was in effect *for its own
  // month*, not today's rate — otherwise updating the rate would silently
  // shift the expected balance for every LBP transaction ever logged.
  //
  // startingBalance/actualBalance are entered (and tb.currency-labeled) in
  // the balance's own native currency, which can be LBP — but `spent` above
  // is already normalized to USD, like every other cross-cutting total in
  // this function. Comparing a raw LBP starting balance against a USD spend
  // figure produced a nonsensical expected/discrepancy for LBP-tracked
  // balances, so convert starting/actual to USD too (at the rate in effect
  // for each one's own date) before doing any arithmetic on them.
  const balanceChecks: DashboardPayload["balanceChecks"] = data.trackedBalances.map((tb) => {
    const spent = data.transactions
      .filter((t) => t.date >= tb.startingDate && t.paymentMethod === tb.paymentMethod
        && (tb.paymentMethod !== "card" || t.cardId === tb.cardId))
      // INCOME transactions received on this same payment method put money
      // IN, so they subtract from "spent" (raising the expected balance)
      // instead of adding to it like every other bucket does.
      .reduce((s, t) => s + (t.bucket === "INCOME" ? -1 : 1) * toUSDForMonth(t.amount, t.currency, t.date.slice(0, 7)), 0);
    const startingUSD = toUSDForMonth(tb.startingBalance, tb.currency, tb.startingDate.slice(0, 7));
    const expected = Math.round((startingUSD - spent) * 100) / 100;
    const actual = tb.actualBalance != null
      ? toUSDForMonth(tb.actualBalance, tb.currency, (tb.actualBalanceDate ?? tb.startingDate).slice(0, 7))
      : null;
    return {
      id: tb.id, name: tb.name, currency: tb.currency, expected,
      actual, actualDate: tb.actualBalanceDate ?? null,
      discrepancy: actual != null ? Math.round((actual - expected) * 100) / 100 : null,
    };
  });

  // ── Net worth trend — today's value merged into the persisted history ──
  // (Persisting the snapshot back into storage happens in the caller —
  // this function stays pure/side-effect-free.)
  const currentYm = monthKey(now);
  const netWorthTrend = [...data.netWorthHistory.filter((h) => h.ym !== currentYm), { ym: currentYm, value: Math.round(nwTotal) }]
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .slice(-12);

  return {
    user: { name: data.userName || "You", currency: "USD", payoffStrategy: "AVALANCHE" },
    period: { year, month },
    hasLoggedTransactions: (data.transactions ?? []).length > 0,
    health: {
      score: totalScore, grade,
      components: [
        { key: "savings", label: "Savings rate", score: Math.round(savingsScore), weight: 25, detail: `${savingsRatePct.toFixed(1)}% of income saved (target ${targetSavingsPct}%)` },
        { key: "needs",   label: "Needs discipline", score: Math.round(needsScore), weight: 20, detail: `Essentials take ${Math.round(needsPct * 100)}% of income (target ≤${budgetTargetPct.needs}%)` },
        { key: "ef",      label: "Safety net", score: Math.round(efScore), weight: 25, detail: `Safety net ${Math.round(efPct)}% funded` },
        { key: "debt",    label: "Debt pressure", score: Math.round(debtScore), weight: 20, detail: `Debt payments are ${Math.round(debtPressurePct * 100)}% of income` },
        { key: "goals",   label: "Goal momentum", score: Math.round(goalScore), weight: 10, detail: `Average pace across ${data.goals.length} active goal${data.goals.length !== 1 ? "s" : ""}` },
      ],
    },
    encouragements: enc,
    streaks,
    month: { income, needsSpend, wantsSpend, savingsContrib, totalSpend, netCashFlow, savingsRatePct },
    emergencyFund: {
      targetMonths: data.emergencyFundTargetMonths,
      targetAmount: Math.round(efTarget),
      balance: efBalance,
      coverageMonths: efMonthlyBase > 0 ? Math.round((efBalance / efMonthlyBase) * 10) / 10 : 0,
      pctFunded: Math.round(efPct),
      remaining: Math.max(0, Math.round(efTarget - efBalance)),
    },
    debt: { totalBalance: totalDebtBalance, count: data.debts.length, plan: debtPlan, comparison: debtComparison },
    goals,
    sixMonthTrend,
    netWorthTrend,
    upcomingRenewals,
    balanceChecks,
    budgetPace,
    budgetRollover,
    effectiveBudgetTargets: { needs: bucketTargetAmt.NEEDS, wants: bucketTargetAmt.WANTS, savings: bucketTargetAmt.SAVINGS },
    netWorth: { assets: Math.round(nwAssets), liabilities: Math.round(nwLiabilities), total: Math.round(nwTotal), ...nwData },
    budgetRule: ruleKey,
    budgetTargetPct,
    budgetTargets: {
      needs:   income * (budgetTargetPct.needs   / 100),
      wants:   income * (budgetTargetPct.wants   / 100),
      savings: income * (budgetTargetPct.savings / 100),
    },
  };
}
