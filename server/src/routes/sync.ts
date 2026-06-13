import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

// POST /api/sync/push  — body: { email, data }
router.post("/push", async (req, res, next) => {
  try {
    const { email, data } = req.body;
    if (!email || !data) return res.status(400).json({ error: "email and data are required." });

    await prisma.userSync.upsert({
      where:  { email: email.toLowerCase().trim() },
      create: { email: email.toLowerCase().trim(), dataJson: JSON.stringify(data) },
      update: { dataJson: JSON.stringify(data), syncedAt: new Date() },
    });

    res.json({ ok: true, syncedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/pull?email=xxx  — returns latest saved data
router.get("/pull", async (req, res, next) => {
  try {
    const email = String(req.query.email ?? "").toLowerCase().trim();
    if (!email) return res.status(400).json({ error: "email query param required." });

    const record = await prisma.userSync.findUnique({ where: { email } });
    if (!record) return res.status(404).json({ error: "No sync data found for this account." });

    res.json({ ok: true, data: JSON.parse(record.dataJson), syncedAt: record.syncedAt });
  } catch (err) {
    next(err);
  }
});

export default router;
