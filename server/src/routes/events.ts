import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";

const router = Router();

// Deliberately no user identity, no IP logged, no third-party SDK — this is
// what "privacy-respecting" means in practice: aggregate counts of a
// closed set of named product events, not who did what. The allow-list
// exists so this can't become an arbitrary write sink for junk data.
const ALLOWED_EVENTS = [
  "onboarding_step_income",
  "onboarding_step_transaction",
  "onboarding_step_overview",
] as const;

const eventSchema = z.object({
  event: z.enum(ALLOWED_EVENTS),
});

// POST /api/events — body: { event }
router.post("/", (req, res, next) => {
  try {
    const { event } = eventSchema.parse(req.body);
    logger.info("analytics_event", { event });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
