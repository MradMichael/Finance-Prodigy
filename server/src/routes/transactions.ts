import { Router } from "express";
import { z } from "zod";
import { prisma, ah, userIdOf, ensureDimDate, num } from "../lib/core";

const router = Router();

const FLOW_TYPES = ["INCOME", "EXPENSE", "TRANSFER"] as const;

const CreateTx = z.object({
  amount:      z.number().positive(),
  flowType:    z.enum(FLOW_TYPES).default("EXPENSE"),
  categoryId:  z.number().int(),
  accountId:   z.number().int(),
  occurredAt:  z.coerce.date().default(() => new Date()),
  merchant:    z.string().max(120).optional(),
  note:        z.string().max(500).optional(),
  isRecurring: z.boolean().default(false),
});

router.post("/", ah(async (req, res) => {
  const body = CreateTx.parse(req.body);
  const dateKey = await ensureDimDate(body.occurredAt);
  const tx = await prisma.factTransaction.create({
    data: { ...body, userId: userIdOf(req), dateKey },
    include: { category: true, account: true },
  });
  res.status(201).json({ ...tx, amount: num(tx.amount) });
}));

const ListQuery = z.object({
  from:       z.coerce.date().optional(),
  to:         z.coerce.date().optional(),
  flowType:   z.enum(FLOW_TYPES).optional(),
  categoryId: z.coerce.number().int().optional(),
  bucket:     z.enum(["NEEDS", "WANTS", "SAVINGS", "INCOME"]).optional(),
  take:       z.coerce.number().int().min(1).max(200).default(50),
  cursor:     z.coerce.number().int().optional(),
});

router.get("/", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const rows = await prisma.factTransaction.findMany({
    where: {
      userId: userIdOf(req),
      ...(q.from || q.to ? { occurredAt: { gte: q.from, lte: q.to } } : {}),
      ...(q.flowType   ? { flowType: q.flowType }       : {}),
      ...(q.categoryId ? { categoryId: q.categoryId }   : {}),
      ...(q.bucket     ? { category: { bucket: q.bucket } } : {}),
    },
    include: { category: true, account: true },
    orderBy: { occurredAt: "desc" },
    take: q.take,
    ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
  });
  res.json(rows.map((r) => ({ ...r, amount: num(r.amount) })));
}));

router.delete("/:id", ah(async (req, res) => {
  const { count } = await prisma.factTransaction.deleteMany({
    where: { id: Number(req.params.id), userId: userIdOf(req) },
  });
  if (count === 0) return res.status(404).json({ error: "Transaction not found" });
  res.status(204).end();
}));

export default router;
