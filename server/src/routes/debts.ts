/**
 * MOMENTUM — /api/debts
 * The Debt Elimination Strategy module. The payoff-plan endpoint runs
 * BOTH strategies and returns them side by side, so the UI toggle is a
 * pure view switch (no extra round trip) and the user always sees what
 * each choice costs or saves.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma, ah, userIdOf, ensureDimDate, num } from "../lib/core";
import { simulateDebtPayoff, DebtInput, round2 } from "../services/financialEngine";

const router = Router();

const toEngine = (d: {
  id: number; name: string;
  currentBalance: unknown; aprPct: unknown; minimumPayment: unknown;
}): DebtInput => ({
  id: d.id,
  name: d.name,
  balance: num(d.currentBalance),
  aprPct: num(d.aprPct),
  minimumPayment: num(d.minimumPayment),
});

// GET /api/debts — active debts + headline stats
router.get("/", ah(async (req, res) => {
  const debts = await prisma.debt.findMany({
    where: { userId: userIdOf(req), status: "ACTIVE" },
    orderBy: { currentBalance: "desc" },
  });
  const totalBalance = round2(debts.reduce((s, d) => s + num(d.currentBalance), 0));
  const totalMinimum = round2(debts.reduce((s, d) => s + num(d.minimumPayment), 0));
  res.json({
    totalBalance,
    totalMinimum,
    debts: debts.map((d) => ({
      id: d.id, name: d.name, lender: d.lender,
      originalPrincipal: num(d.originalPrincipal),
      currentBalance: num(d.currentBalance),
      aprPct: num(d.aprPct),
      minimumPayment: num(d.minimumPayment),
      paidPct: num(d.originalPrincipal) > 0
        ? round2((1 - num(d.currentBalance) / num(d.originalPrincipal)) * 100)
        : 0,
    })),
  });
}));

// POST /api/debts
const CreateDebt = z.object({
  name: z.string().min(1).max(80),
  lender: z.string().max(80).optional(),
  originalPrincipal: z.number().positive(),
  currentBalance: z.number().min(0),
  aprPct: z.number().min(0).max(99.99),
  minimumPayment: z.number().min(0),
  startDate: z.coerce.date().optional(),
});

router.post("/", ah(async (req, res) => {
  const body = CreateDebt.parse(req.body);
  const debt = await prisma.debt.create({ data: { ...body, userId: userIdOf(req) } });
  res.status(201).json(debt);
}));

// ------------------------------------------------------------------ //
// GET /api/debts/payoff-plan?extra=250
// Runs Snowball AND Avalanche with the same extra payment; returns the
// user's preferred strategy as `plan` plus a head-to-head comparison.
// ------------------------------------------------------------------ //
router.get("/payoff-plan", ah(async (req, res) => {
  const userId = userIdOf(req);
  const extra = Math.max(0, Number(req.query.extra ?? 0));

  const [user, debts] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.debt.findMany({ where: { userId, status: "ACTIVE" } }),
  ]);

  const inputs = debts.map(toEngine);
  const snowball = simulateDebtPayoff(inputs, extra, "SNOWBALL");
  const avalanche = simulateDebtPayoff(inputs, extra, "AVALANCHE");
  const baseline = simulateDebtPayoff(inputs, 0, user.payoffStrategy); // minimums only

  const chosen = user.payoffStrategy === "SNOWBALL" ? snowball : avalanche;

  res.json({
    preferredStrategy: user.payoffStrategy,
    extraMonthly: extra,
    plan: chosen,
    comparison: {
      snowball: { months: snowball.months, totalInterest: snowball.totalInterest, debtFreeDateDisplay: snowball.debtFreeDateDisplay },
      avalanche: { months: avalanche.months, totalInterest: avalanche.totalInterest, debtFreeDateDisplay: avalanche.debtFreeDateDisplay },
      avalancheSavesVsSnowball: round2(snowball.totalInterest - avalanche.totalInterest),
    },
    versusMinimumsOnly: baseline.feasible && chosen.feasible
      ? {
          monthsSooner: baseline.months - chosen.months,
          interestSaved: round2(baseline.totalInterest - chosen.totalInterest),
        }
      : null,
  });
}));

// ------------------------------------------------------------------ //
// POST /api/debts/:id/payments — log a payment. The interest portion
// is computed at write time (one month's accrual on the open balance,
// capped at the payment) so fact_debt_payment is BI-ready as stored.
// ------------------------------------------------------------------ //
const Payment = z.object({
  amount: z.number().positive(),
  occurredAt: z.coerce.date().default(() => new Date()),
  note: z.string().max(300).optional(),
});

router.post("/:id/payments", ah(async (req, res) => {
  const userId = userIdOf(req);
  const debtId = Number(req.params.id);
  const body = Payment.parse(req.body);
  const dateKey = await ensureDimDate(body.occurredAt);

  const result = await prisma.$transaction(async (db) => {
    const debt = await db.debt.findFirst({ where: { id: debtId, userId, status: "ACTIVE" } });
    if (!debt) return null;

    const balance = num(debt.currentBalance);
    const interestPortion = round2(Math.min(body.amount, (balance * num(debt.aprPct)) / 1200));
    const principalPortion = round2(body.amount - interestPortion);
    const newBalance = round2(Math.max(0, balance - principalPortion));

    await db.factDebtPayment.create({
      data: { debtId, userId, dateKey, amount: body.amount, principalPortion, interestPortion, note: body.note },
    });

    const updated = await db.debt.update({
      where: { id: debtId },
      data: { currentBalance: newBalance, ...(newBalance === 0 ? { status: "PAID_OFF" } : {}) },
    });
    return { updated, principalPortion, interestPortion };
  });

  if (!result) return res.status(404).json({ error: "Debt not found or already paid off" });

  res.status(201).json({
    debtId,
    newBalance: num(result.updated.currentBalance),
    principalPortion: result.principalPortion,
    interestPortion: result.interestPortion,
    status: result.updated.status,
    celebration:
      result.updated.status === "PAID_OFF"
        ? `🏁 ${result.updated.name} — PAID OFF. One less claim on your future income.`
        : `$${result.principalPortion.toFixed(2)} of that went straight to principal.`,
  });
}));

export default router;
