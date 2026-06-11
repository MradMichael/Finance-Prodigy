/**
 * MOMENTUM — /api/dashboard
 * One call, one payload: everything the Motivation Engine needs.
 * Aggregates come from the SQL views; simulations from the engine.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma, ah, userIdOf, monthKeyRange, num } from "../lib/core";
import {
  calculateHealthScore, simulateDebtPayoff, projectGoal,
  emergencyFundStatus, buildEncouragements, round2,
} from "../services/financialEngine";

const router = Router();

router.get("/", ah(async (req, res) => {
  const userId = userIdOf(req);
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const { from, to } = monthKeyRange(year, month);
  const extra = Math.max(0, Number(req.query.extra ?? 0));

  const [user, debts, goals] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.debt.findMany({ where: { userId, status: "ACTIVE" } }),
    prisma.goal.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ priority: "asc" }, { targetDate: "asc" }],
    }),
  ]);

  // --- Month-to-date money in / money out, by bucket (single scan) ---
  const mtd = await prisma.$queryRaw<{ bucket: string; flow: string; total: number }[]>(Prisma.sql`
    SELECT c.bucket::text AS bucket, t.flow_type::text AS flow, SUM(t.amount)::float AS total
    FROM fact_transaction t
    JOIN dim_category c ON c.id = t.category_id
    WHERE t.user_id = ${userId} AND t.date_key BETWEEN ${from} AND ${to}
    GROUP BY c.bucket, t.flow_type
  `);
  const sumOf = (bucket?: string, flow?: string) =>
    mtd.filter((r) => (!bucket || r.bucket === bucket) && (!flow || r.flow === flow))
       .reduce((s, r) => s + r.total, 0);

  const income = sumOf(undefined, "INCOME");
  const needsSpend = sumOf("NEEDS", "EXPENSE");
  const wantsSpend = sumOf("WANTS", "EXPENSE");
  const savingsContrib = sumOf("SAVINGS", "EXPENSE");

  // --- Six-month trend from the view ---
  const trend = await prisma.$queryRaw<{ ym_key: number; bucket: string; spend: number; income: number }[]>(Prisma.sql`
    SELECT ym_key::int, bucket::text AS bucket, spend::float, income::float
    FROM vw_monthly_bucket
    WHERE user_id = ${userId}
    ORDER BY ym_key DESC
    LIMIT 18
  `);
  const trendByMonth = new Map<number, { ymKey: number; income: number; spend: number }>();
  for (const r of trend) {
    const m = trendByMonth.get(r.ym_key) ?? { ymKey: r.ym_key, income: r.income ?? 0, spend: 0 };
    m.spend += r.spend;
    m.income = Math.max(m.income, r.income ?? 0);
    trendByMonth.set(r.ym_key, m);
  }
  const sixMonthTrend = [...trendByMonth.values()].sort((a, b) => a.ymKey - b.ymKey).slice(-6);

  // --- Emergency fund (3-month trailing essential spend) ---
  const trailing = await prisma.$queryRaw<{ avg_needs: number | null }[]>(Prisma.sql`
    SELECT AVG(spend)::float AS avg_needs FROM (
      SELECT spend FROM vw_monthly_bucket
      WHERE user_id = ${userId} AND bucket = 'NEEDS'
      ORDER BY ym_key DESC LIMIT 3
    ) last3
  `);
  const essentialMonthly = trailing[0]?.avg_needs ?? needsSpend;
  const efGoal = goals.find((g) => g.type === "EMERGENCY_FUND");
  const ef = emergencyFundStatus(num(efGoal?.currentAmount), essentialMonthly, user.efTargetMonths);

  // --- Debt plan (user's preferred strategy + chosen extra) ---
  const debtInputs = debts.map((d) => ({
    id: d.id, name: d.name,
    balance: num(d.currentBalance), aprPct: num(d.aprPct), minimumPayment: num(d.minimumPayment),
  }));
  const debtPlan = debts.length
    ? simulateDebtPayoff(debtInputs, extra, user.payoffStrategy, now)
    : undefined;
  const totalDebtBalance = round2(debtInputs.reduce((s, d) => s + d.balance, 0));
  const monthlyDebtPayments = round2(debtInputs.reduce((s, d) => s + d.minimumPayment, 0) + extra);

  // --- Goals with projections ---
  const goalCards = goals
    .filter((g) => g.type !== "EMERGENCY_FUND")
    .map((g) => ({
      id: g.id, name: g.name, emoji: g.emoji, type: g.type,
      targetAmount: num(g.targetAmount), currentAmount: num(g.currentAmount),
      projection: projectGoal({
        targetAmount: num(g.targetAmount), currentAmount: num(g.currentAmount),
        targetDate: g.targetDate, createdAt: g.createdAt,
      }),
    }));

  // --- Health score + encouragements ---
  const health = calculateHealthScore({
    monthlyIncome: income,
    needsSpend, wantsSpend, savingsContrib,
    efPctFunded: ef.pctFunded,
    monthlyDebtPayments,
    goalPaceRatios: goalCards.map((g) => g.projection.paceRatio),
  });

  const savingsRatePct = income > 0 ? round2((savingsContrib / income) * 100) : 0;
  const encouragements = buildEncouragements({
    health, ef, debtPlan,
    goals: goalCards.map((g) => ({ name: g.name, projection: g.projection })),
    savingsRatePct,
  });

  res.json({
    user: { name: user.name, currency: user.currency, payoffStrategy: user.payoffStrategy },
    period: { year, month },
    health,
    encouragements,
    month: {
      income, needsSpend, wantsSpend, savingsContrib,
      totalSpend: round2(needsSpend + wantsSpend + savingsContrib),
      netCashFlow: round2(income - needsSpend - wantsSpend - savingsContrib),
      savingsRatePct,
    },
    emergencyFund: ef,
    debt: { totalBalance: totalDebtBalance, count: debts.length, plan: debtPlan ?? null },
    goals: goalCards,
    sixMonthTrend,
  });
}));

export default router;
