import type { LocalFinancials, BudgetRuleKey } from "./localData";
import { monthlyEquivalent, BUDGET_RULES } from "./localData";

interface Projection {
  pctComplete: number; monthsRemaining: number; requiredMonthly: number;
  paceRatio: number; onTrack: boolean; targetDateDisplay: string;
}

export interface DashboardPayload {
  user: { name: string; currency: string; payoffStrategy: "SNOWBALL" | "AVALANCHE" };
  period: { year: number; month: number };
  budgetRule: BudgetRuleKey;
  budgetTargets: { needs: number; wants: number; savings: number };
  health: {
    score: number; grade: string;
    components: { key: string; label: string; score: number; weight: number; detail: string }[];
  };
  encouragements: string[];
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
  };
  goals: {
    id: number; name: string; emoji: string | null; type: string;
    targetAmount: number; currentAmount: number; projection: Projection;
  }[];
  sixMonthTrend: { ymKey: number; income: number; spend: number }[];
  netWorth: {
    assets: number;
    liabilities: number;
    total: number;
    tier: string;
    tierColor: "jade" | "brass" | "coral" | "mute";
    suggestions: string[];
  };
}

function dateFmt(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

export function computeDashboard(data: LocalFinancials): DashboardPayload {
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

  const lbpRate = data.lbpRate ?? 89500;
  const toUSD = (amount: number, currency?: string) =>
    currency === "LBP" ? amount / lbpRate : amount;

  const monthTx = data.transactions.filter((t) => t.date.startsWith(prefix));

  // Recurring contributions this month (pro-rated by frequency, converted to USD)
  const activeRecurring = (data.recurring ?? []);
  const recurNeeds   = activeRecurring.filter((r) => r.bucket === "NEEDS").reduce((s, r)   => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);
  const recurWants   = activeRecurring.filter((r) => r.bucket === "WANTS").reduce((s, r)   => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);
  const recurSavings = activeRecurring.filter((r) => r.bucket === "SAVINGS").reduce((s, r) => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);

  const needsSpend  = monthTx.filter((t) => t.bucket === "NEEDS").reduce((s, t) => s + toUSD(t.amount, t.currency), 0)   + recurNeeds;
  const wantsSpend  = monthTx.filter((t) => t.bucket === "WANTS").reduce((s, t) => s + toUSD(t.amount, t.currency), 0)   + recurWants;
  const savingsContrib = monthTx.filter((t) => t.bucket === "SAVINGS").reduce((s, t) => s + toUSD(t.amount, t.currency), 0) + recurSavings;
  const totalSpend  = needsSpend + wantsSpend + savingsContrib;
  const income      = Math.max(data.income, 1); // guard div-by-zero
  const netCashFlow = income - totalSpend;
  const savingsRatePct = (savingsContrib / income) * 100;

  // ── Health components ────────────────────────────────────────────
  const targetSavingsPct = budgetTargetPct.savings;
  const targetNeedsPct   = budgetTargetPct.needs / 100;
  const savingsScore = Math.min(100, (savingsRatePct / targetSavingsPct) * 100);
  const needsPct = needsSpend / income;
  const needsScore = needsPct <= targetNeedsPct ? 100 : Math.max(0, 100 - (needsPct - targetNeedsPct) * 400);

  const efMonthlyBase = needsSpend || income * 0.5;
  const efTarget  = data.emergencyFundTargetMonths * efMonthlyBase;
  const efBalance = data.emergencyFundBalance;
  const efPct     = efTarget > 0 ? Math.min(100, (efBalance / efTarget) * 100) : 0;
  const efScore   = efPct;

  const totalMinPayments = data.debts.reduce((s, d) => s + d.minPayment, 0);
  const debtPressurePct  = totalMinPayments / income;
  const debtScore = Math.max(0, 100 - debtPressurePct * 400);

  const goalScores = data.goals.map((g) => {
    const rem = g.targetAmount - g.currentAmount;
    if (rem <= 0) return 1;
    const ms = Math.max(1, (new Date(g.targetDate).getTime() - now.getTime()) / (30.44 * 24 * 3600 * 1000));
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
    enc.push("Set your monthly income in the panel — that one number unlocks everything else.");
  } else if (savingsRatePct >= 20) {
    enc.push(`${savingsRatePct.toFixed(1)}% savings rate — you've cleared the 20% bar. Every extra dollar is compounding quietly in the background.`);
  } else if (savingsRatePct >= 10) {
    enc.push(`Saving ${savingsRatePct.toFixed(1)}% this month. You're ${(20 - savingsRatePct).toFixed(1)} points from the ideal 20% — closer than you think.`);
  } else if (savingsRatePct > 0) {
    enc.push(`${savingsRatePct.toFixed(1)}% saved this month. Small, but it's real. The habit matters more than the amount right now.`);
  }
  if (efPct >= 100) {
    enc.push("Emergency fund fully funded — you've built the buffer that lets you take smart risks.");
  } else if (efPct >= 50) {
    enc.push(`Safety net is ${Math.round(efPct)}% built. Past halfway — the hard part is behind you.`);
  } else if (efPct > 0) {
    enc.push(`Emergency fund at ${Math.round(efPct)}%. Even a partial buffer changes how you handle surprises.`);
  }
  if (data.debts.length === 0 && data.income > 0) {
    enc.push("Zero debts. Every dollar you earn goes to your future, not your past.");
  } else if (debtPressurePct > 0.25) {
    enc.push(`Debt payments are ${Math.round(debtPressurePct * 100)}% of income — a priority worth attacking. Add extra payments in the debt section to see the timeline shrink.`);
  }
  if (enc.length === 0) {
    enc.push("Log your first transaction below. The picture sharpens quickly once data starts flowing in.");
  }

  // ── Debt plan ────────────────────────────────────────────────────
  const totalDebtBalance = data.debts.reduce((s, d) => s + d.balance, 0);
  let debtPlan = null;
  if (data.debts.length > 0 && totalDebtBalance > 0) {
    const extra = Math.max(0, netCashFlow * 0.3);
    const monthlyPayment = totalMinPayments + extra;
    if (monthlyPayment > 0) {
      const months = Math.ceil(totalDebtBalance / monthlyPayment);
      const avgApr = data.debts.reduce((s, d) => s + d.apr * d.balance, 0) / totalDebtBalance;
      const totalInterest = Math.round((avgApr / 100 / 12) * totalDebtBalance * months * 0.5);
      const freeDate = new Date(now);
      freeDate.setMonth(freeDate.getMonth() + months);
      debtPlan = {
        feasible: true, months,
        debtFreeDateDisplay: dateFmt(freeDate),
        totalInterest,
        monthlyCommitment: Math.round(monthlyPayment),
      };
    } else {
      debtPlan = { feasible: false, months: 0, debtFreeDateDisplay: null, totalInterest: 0, monthlyCommitment: 0, warning: "Monthly income is fully consumed by needs and wants — try trimming wants to free up cash for debt." };
    }
  }

  // ── Goals ────────────────────────────────────────────────────────
  const goals = data.goals.map((g, i) => {
    const rem = Math.max(0, g.targetAmount - g.currentAmount);
    const td = new Date(g.targetDate);
    const ms = Math.max(1, Math.round((td.getTime() - now.getTime()) / (30.44 * 24 * 3600 * 1000)));
    const req = rem / ms;
    const pace = req > 0 ? Math.min(2, savingsContrib / req) : 1;
    return {
      id: i + 1, name: g.name, emoji: g.emoji || null, type: "SAVINGS",
      targetAmount: g.targetAmount, currentAmount: g.currentAmount,
      projection: {
        pctComplete: Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)),
        monthsRemaining: ms,
        requiredMonthly: Math.round(req),
        paceRatio: Math.round(pace * 100) / 100,
        onTrack: pace >= 0.9,
        targetDateDisplay: dateFmt(td),
      },
    };
  });

  // ── Net worth ─────────────────────────────────────────────────────
  const nwAssets      = data.emergencyFundBalance + data.goals.reduce((s, g) => s + toUSD(g.currentAmount, undefined), 0);
  const nwLiabilities = totalDebtBalance;
  const nwTotal       = nwAssets - nwLiabilities;

  type NWColor = "jade" | "brass" | "coral" | "mute";
  function netWorthTier(nw: number): { tier: string; tierColor: NWColor; suggestions: string[] } {
    if (nw < -20000) return {
      tier: "Heavy debt load",
      tierColor: "coral",
      suggestions: [
        "Target the highest-APR debt first — that's where interest is burning fastest.",
        "Every dollar above the minimum payment is money that stops compounding against you.",
        "Even $50 extra per month cuts months off your payoff date — run the numbers in Debts.",
      ],
    };
    if (nw < -5000) return {
      tier: "Rebuilding",
      tierColor: "coral",
      suggestions: [
        "You're climbing — the negative number is shrinking each month.",
        "Consider a small side income for 3–6 months; even $200/month accelerates this significantly.",
        "Once you clear the debt, redirect that minimum payment into savings automatically.",
      ],
    };
    if (nw < 0) return {
      tier: "Almost positive",
      tierColor: "brass",
      suggestions: [
        "You're close to zero — that milestone shifts your psychology entirely.",
        "Focus on one debt at a time to cross into positive territory fast.",
        "Celebrate each debt closed — that freed cash is your first wealth-building tool.",
      ],
    };
    if (nw < 5000) return {
      tier: "Breaking even",
      tierColor: "brass",
      suggestions: [
        "Your liabilities are covered. Now every dollar saved is pure net worth growth.",
        "Start or grow your emergency fund — it's your first true asset.",
        "Set a goal to hit $5,000 in savings; that buffer changes how you handle surprises.",
      ],
    };
    if (nw < 25000) return {
      tier: "Foundation builder",
      tierColor: "jade",
      suggestions: [
        "You're ahead of most people your age — keep the momentum going.",
        "Compound growth starts to matter here. Even modest returns on $10K make a difference.",
        "Consider diversifying: savings, goals, and if applicable, low-risk investments.",
      ],
    };
    if (nw < 100000) return {
      tier: "Growing wealth",
      tierColor: "jade",
      suggestions: [
        "Significant position — you have real financial resilience now.",
        "At this level, optimizing income is often more powerful than cutting expenses.",
        "Consider whether your money is working as hard as you are.",
      ],
    };
    return {
      tier: "Wealth building",
      tierColor: "jade",
      suggestions: [
        "Strong financial foundation — protect it with diversification.",
        "Focus shifts from accumulation to optimization and preservation.",
        "Reinvesting returns rather than spending them is what separates this level from the next.",
      ],
    };
  }
  const nwData = netWorthTier(nwTotal);

  // ── Six-month trend ───────────────────────────────────────────────
  const sixMonthTrend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(year, month - 1 - (5 - i), 1);
    const ymKey = d.getFullYear() * 100 + (d.getMonth() + 1);
    const isCurrent = i === 5;
    const mo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const tx = data.transactions.filter((t) => t.date.startsWith(mo));
    const sp = tx.reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
    return { ymKey, income: isCurrent ? income : (sp > 0 ? income : 0), spend: sp };
  });

  return {
    user: { name: data.userName || "You", currency: "USD", payoffStrategy: "AVALANCHE" },
    period: { year, month },
    health: {
      score: totalScore, grade,
      components: [
        { key: "savings", label: "Savings rate", score: Math.round(savingsScore), weight: 25, detail: `${savingsRatePct.toFixed(1)}% of income saved (target ${targetSavingsPct}%)` },
        { key: "needs",   label: "Needs discipline", score: Math.round(needsScore), weight: 20, detail: `Essentials take ${Math.round(needsPct * 100)}% of income (target ≤${budgetTargetPct.needs}%)` },
        { key: "ef",      label: "Safety net", score: Math.round(efScore), weight: 25, detail: `Emergency fund ${Math.round(efPct)}% funded` },
        { key: "debt",    label: "Debt pressure", score: Math.round(debtScore), weight: 20, detail: `Debt payments are ${Math.round(debtPressurePct * 100)}% of income` },
        { key: "goals",   label: "Goal momentum", score: Math.round(goalScore), weight: 10, detail: `Average pace across ${data.goals.length} active goal${data.goals.length !== 1 ? "s" : ""}` },
      ],
    },
    encouragements: enc,
    month: { income, needsSpend, wantsSpend, savingsContrib, totalSpend, netCashFlow, savingsRatePct },
    emergencyFund: {
      targetMonths: data.emergencyFundTargetMonths,
      targetAmount: Math.round(efTarget),
      balance: efBalance,
      coverageMonths: efMonthlyBase > 0 ? Math.round((efBalance / efMonthlyBase) * 10) / 10 : 0,
      pctFunded: Math.round(efPct),
      remaining: Math.max(0, Math.round(efTarget - efBalance)),
    },
    debt: { totalBalance: totalDebtBalance, count: data.debts.length, plan: debtPlan },
    goals,
    sixMonthTrend,
    netWorth: { assets: Math.round(nwAssets), liabilities: Math.round(nwLiabilities), total: Math.round(nwTotal), ...nwData },
    budgetRule: ruleKey,
    budgetTargets: {
      needs:   income * (budgetTargetPct.needs   / 100),
      wants:   income * (budgetTargetPct.wants   / 100),
      savings: income * (budgetTargetPct.savings / 100),
    },
  };
}
