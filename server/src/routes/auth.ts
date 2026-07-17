import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { emailSchema } from "../lib/validation";

const router = Router();

const emailQuerySchema = z.object({
  email: emailSchema,
});

/**
 * GET /api/auth/check-email?email=x — { exists: boolean }
 *
 * There's no real server-side user registry (see README's roadmap: sign-up
 * only ever writes to that browser's own localStorage), so "exists" here
 * specifically means "this email has synced (pushed) at least once from
 * some device" — the only thing the server can actually know. It's an
 * interim mitigation, not full duplicate-email detection: two people can
 * still register the same email locally on two different devices with no
 * warning until one of them tries to sync. Purpose is narrower but still
 * useful — warn someone signing up with an email that already has synced
 * data elsewhere, before they invest in an account that'll conflict with
 * it the first time they push.
 */
router.get("/check-email", async (req, res, next) => {
  try {
    const { email } = emailQuerySchema.parse(req.query);
    const record = await prisma.userSync.findUnique({ where: { email }, select: { id: true } });
    res.json({ exists: record !== null });
  } catch (err) {
    next(err);
  }
});

export default router;
