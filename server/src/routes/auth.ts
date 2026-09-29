import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { emailSchema } from "../lib/validation";

const router = Router();

const checkEmailSchema = z.object({
  email: emailSchema,
});

/**
 * POST /api/auth/check-email — body: { email } — { exists: boolean }
 *
 * 2.4.165 B: the address travels in the body, not the URL, because a query
 * string is written into the hosts' request logs and a body is not. Same
 * three-step transition as /api/sync/pull (see routes/sync.ts): POST is
 * accepted alongside the old GET until the client has switched and no open
 * tab can still be running the old one; then GET is removed. Each method
 * reads only its own source.
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
const checkEmail = (from: "body" | "query"): RequestHandler => async (req, res, next) => {
  try {
    const { email } = checkEmailSchema.parse(from === "body" ? req.body : req.query);
    const record = await prisma.userSync.findUnique({ where: { email }, select: { id: true } });
    res.json({ exists: record !== null });
  } catch (err) {
    next(err);
  }
};
router.post("/check-email", checkEmail("body"));
// TRANSITIONAL (2.4.165 B step 1): the old shape, kept only until step 3.
router.get("/check-email", checkEmail("query"));

export default router;
