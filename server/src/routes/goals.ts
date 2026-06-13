import { Router } from "express";
import { z } from "zod";
import { prisma, ah, userIdOf, ensureDimDate, num } from "../lib/core";
import { projectGoal, emergencyFundStatus, fmtDate } from "../services/financialEngine";

const router = Router();

const GOAL_TYPES = ["EMERGENCY_FUND", "TRAVEL", "PURCHASE", "EDUCATION", "CUSTOM"] as const;

const serializeGoal = (g: {
  id: number; name: string; emoji: string | null; type: string;
  targetAmount: unknown; currentAmount: unknown;
  targetDate: Date; createdAt: Date; status: string; priority: number;
}) => {
  const projection = projectGoal({
    targetAmount: num(g.targetAmount),
    currentAmount: num(g.currentAmount),
    targetDate: g.targetDate,
    createdAt: g.createdAt,
  });
  return {
    id: g.id, name: g.name, emoji: g.emoji, type: g.type,
    status: g.status, priority: g.priority,
    targetAmount: num(g.targetAmount),
    currentAmount: num(g.currentAmount),
    targetDate: g.targetDate, projection,
  };
};

// GET /api/goals
router.get("/", ah(async (req, res) => {
  const goals = await prisma.goal.findMany({
    where: { userId: userIdOf(req), status: { in: ["ACTIVE", "ACHIEVED"] } },
    orderBy: [{ priority: "asc" }, { targetDate: "asc" }],
  });
  res.json(goals.map(serializeGoal));
}));

// POST /api/goals
const CreateGoal = z.object({
  name:           z.string().min(1).max(80),
  emoji:          z.string().max(8).optional(),
  type:           z.enum(GOAL_TYPES).default("CUSTOM"),
  targetAmount:   z.number().positive(),
  startingAmount: z.number().min(0).default(0),
  targetDate:     z.coerce.date(),
  priority:       z.number().int().min(1).max(5).default(3),
});

router.post("/", ah(async (req, res) => {
  const body = CreateGoal.parse(req.body);
  const { startingAmount, ...rest } = body;
  const goal = await prisma.goal.create({
    data: { ...rest, userId: userIdOf(req), currentAmount: startingAmount },
  });
  res.status(201).json(serializeGoal(goal));
}));

// PATCH /api/goals/:id
const PatchGoal = CreateGoal.partial().extend({
  status: z.enum(["ACTIVE", "ACHIEVED", "PAUSED", "ARCHIVED"]).optional(),
});

router.patch("/:id", ah(async (req, res) => {
  const body = PatchGoal.parse(req.body);
  const { startingAmount, ...rest } = body;
  const { count } = await prisma.goal.updateMany({
    where: { id: Number(req.params.id), userId: userIdOf(req) },
    data: rest,
  });
  if (count === 0) return res.status(404).json({ error: "Goal not found" });
  const goal = await prisma.goal.findUniqueOrThrow({ where: { id: Number(req.params.id) } });
  res.json(serializeGoal(goal));
}));

// POST /api/goals/:id/contributions
const Contribute = z.object({
  amount:     z.number().positive(),
  occurredAt: z.coerce.date().default(() => new Date()),
  note:       z.string().max(300).optional(),
});

router.post("/:id/contributions", ah(async (req, res) => {
  const userId = userIdOf(req);
  const goalId = Number(req.params.id);
  const body   = Contribute.parse(req.body);
  const dateKey = await ensureDimDate(body.occurredAt);

  const result = await prisma.$transaction(async (db) => {
    const goal = await db.goal.findFirst({ where: { id: goalId, userId } });
    if (!goal) return null;

    await db.factGoalContribution.create({
      data: { goalId, userId, dateKey, amount: body.amount, note: body.note },
    });

    const newAmount = num(goal.currentAmount) + body.amount;
    const achieved  = newAmount >= num(goal.targetAmount) && goal.status === "ACTIVE";

    return db.goal.update({
      where: { id: goalId },
      data: { currentAmount: newAmount, ...(achieved ? { status: "ACHIEVED" } : {}) },
    });
  });

  if (!result) return res.status(404).json({ error: "Goal not found" });

  const payload = serializeGoal(result);
  res.status(201).json({
    ...payload,
    celebration:
      result.status === "ACHIEVED"
        ? `🎉 ${result.name} is fully funded as of ${fmtDate(body.occurredAt)}. You set a target — and you hit it.`
        : `+$${body.amount.toFixed(2)} toward ${result.name}. ${payload.projection.pctComplete.toFixed(0)}% there.`,
  });
}));

// GET /api/goals/emergency-fund
router.get("/emergency-fund", ah(async (req, res) => {
  const userId = userIdOf(req);
  const user   = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const needsTx = await prisma.factTransaction.aggregate({
    where: { userId, flowType: "EXPENSE", category: { bucket: "NEEDS" }, occurredAt: { gte: since } },
    _sum: { amount: true },
  });
  const essentialMonthly = num(needsTx._sum.amount) / 3;

  const efGoal = await prisma.goal.findFirst({
    where: { userId, type: "EMERGENCY_FUND", status: { in: ["ACTIVE", "ACHIEVED"] } },
  });

  const status = emergencyFundStatus(num(efGoal?.currentAmount), essentialMonthly, user.efTargetMonths);

  res.json({
    ...status,
    goalId: efGoal?.id ?? null,
    hint: efGoal ? null : "No emergency fund goal yet — create one with type EMERGENCY_FUND.",
  });
}));

export default router;
