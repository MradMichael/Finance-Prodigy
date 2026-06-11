/**
 * MOMENTUM — /api/transactions
 * Logging + the "How Much" analytics engine.
 *
 * Layering: list/insert use Prisma; the analytical endpoints read the
 * SQL views (vw_monthly_bucket, vw_category_variance) so the API and
 * any external BI tool always agree on the numbers.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma, FlowType } from "@prisma/client";
import { prisma, ah, userIdOf, ensureDimDate, monthKeyRange, num } from "../lib/core";

const router = Router();

// ------------------------------------------------------------------ //
// POST /api/transactions — log a transaction (frictionless: only
// amount + category are truly required; everything else defaults)
// ------------------------------------------------------------------ //
const CreateTx = z.object({
  amount: z.number().positive(),
  flowType: z.nativeEnum(FlowType).default("EXPENSE"),
  categoryId: z.number().int(),
  accountId: z.number().int(),
  occurredAt: z.coerce.date().default(() => new Date()),
  merchant: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
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

// ------------------------------------------------------------------ //
// GET /api/transactions?from=2026-06-01&to=2026-06-30&bucket=WANTS
// ------------------------------------------------------------------ //
const ListQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  flowType: z.nativeEnum(FlowType).optional(),
  categoryId: z.coerce.number().int().optional(),
  bucket: z.enum(["NEEDS", "WANTS", "SAVINGS", "INCOME"]).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().optional(),
});

router.get("/", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const rows = await prisma.factTransaction.findMany({
    where: {
      userId: userIdOf(req),
      ...(q.from || q.to ? { occurredAt: { gte: q.from, lte: q.to } } : {}),
      ...(q.flowType ? { flowType: q.flowType } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.bucket ? { category: { bucket: q.bucket } } : {}),
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

// ------------------------------------------------------------------ //
// GET /api/transactions/summary/:year/:month
// The month at a glance: income, actual 50/30/20 split vs targets,
// savings rate, top spend categories. Framed as progress, not deficit.
// ------------------------------------------------------------------ //
router.get("/summary/:year/:month", ah(async (req, res) => {
  const userId = userIdOf(req);
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const { from, to } = monthKeyRange(year, month);

  type BucketRow = { bucket: string; total: number };
  const buckets = await prisma.$queryRaw<BucketRow[]>(Prisma.sql`
    SELECT c.bucket::text AS bucket, COALESCE(SUM(t.amount), 0)::float AS total
    FROM fact_transaction t
    JOIN dim_category c ON c.id = t.category_id
    WHERE t.user_id = ${userId}
      AND t.date_key BETWEEN ${from} AND ${to}
      AND t.flow_type = 'EXPENSE'::"FlowType"
    GROUP BY c.bucket
  `);

  const incomeRow = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT COALESCE(SUM(amount), 0)::float AS total
    FROM fact_transaction
    WHERE user_id = ${userId}
      AND date_key BETWEEN ${from} AND ${to}
      AND flow_type = 'INCOME'::"FlowType"
  `);
  const income = incomeRow[0]?.total ?? 0;

  const budget = await prisma.budget.findUnique({
    where: { userId_year_month: { userId, year, month } },
  });
  const pct = { NEEDS: budget?.needsPct ?? 50, WANTS: budget?.wantsPct ?? 30, SAVINGS: budget?.savingsPct ?? 20 };
  const baseline = income > 0 ? income : num(budget?.expectedIncome);

  const get = (b: string) => buckets.find((r) => r.bucket === b)?.total ?? 0;
  const split = (["NEEDS", "WANTS", "SAVINGS"] as const).map((b) => {
    const actual = get(b);
    const target = (baseline * pct[b]) / 100;
    return {
      bucket: b,
      actual,
      target: Math.round(target * 100) / 100,
      pctOfIncome: baseline > 0 ? Math.round((actual / baseline) * 1000) / 10 : 0,
      targetPct: pct[b],
      headroom: Math.round((target - actual) * 100) / 100, // positive = room left
    };
  });

  const topCategories = await prisma.$queryRaw<{ category: string; bucket: string; total: number }[]>(Prisma.sql`
    SELECT c.name AS category, c.bucket::text AS bucket, SUM(t.amount)::float AS total
    FROM fact_transaction t
    JOIN dim_category c ON c.id = t.category_id
    WHERE t.user_id = ${userId}
      AND t.date_key BETWEEN ${from} AND ${to}
      AND t.flow_type = 'EXPENSE'::"FlowType"
    GROUP BY c.name, c.bucket
    ORDER BY total DESC
    LIMIT 5
  `);

  const totalSpend = split.reduce((s, b) => s + b.actual, 0);
  res.json({
    year, month, income, totalSpend,
    netCashFlow: Math.round((income - totalSpend) * 100) / 100,
    savingsRatePct: baseline > 0 ? Math.round((get("SAVINGS") / baseline) * 1000) / 10 : 0,
    split, topCategories,
  });
}));

// ------------------------------------------------------------------ //
// GET /api/transactions/variance/:year/:month — planned vs actual per
// category, straight from vw_category_variance (DB does the math).
// ------------------------------------------------------------------ //
router.get("/variance/:year/:month", ah(async (req, res) => {
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`
    SELECT category_id, category, bucket::text AS bucket,
           planned_amount::float  AS planned,
           actual_amount::float   AS actual,
           variance::float        AS variance,
           pct_consumed::float    AS pct_consumed
    FROM vw_category_variance
    WHERE user_id = ${userIdOf(req)}
      AND year = ${Number(req.params.year)}
      AND month = ${Number(req.params.month)}
    ORDER BY variance ASC
  `);
  res.json(rows);
}));

// ------------------------------------------------------------------ //
// GET /api/transactions/trend?months=6 — income vs spend per month,
// from vw_monthly_bucket. Feeds the dashboard cash-flow chart.
// ------------------------------------------------------------------ //
router.get("/trend", ah(async (req, res) => {
  const months = Math.min(24, Math.max(1, Number(req.query.months ?? 6)));
  const rows = await prisma.$queryRaw<
    { ym_key: number; bucket: string; spend: number; income: number }[]
  >(Prisma.sql`
    SELECT ym_key::int, bucket::text AS bucket, spend::float, income::float
    FROM vw_monthly_bucket
    WHERE user_id = ${userIdOf(req)}
    ORDER BY ym_key DESC
    LIMIT ${months * 3}
  `);

  // Pivot bucket rows → one object per month
  const byMonth = new Map<number, { ymKey: number; income: number; NEEDS: number; WANTS: number; SAVINGS: number }>();
  for (const r of rows) {
    const m = byMonth.get(r.ym_key) ?? { ymKey: r.ym_key, income: r.income ?? 0, NEEDS: 0, WANTS: 0, SAVINGS: 0 };
    (m as Record<string, number>)[r.bucket] = r.spend;
    m.income = Math.max(m.income, r.income ?? 0);
    byMonth.set(r.ym_key, m);
  }
  res.json([...byMonth.values()].sort((a, b) => a.ymKey - b.ymKey).slice(-months));
}));

export default router;
