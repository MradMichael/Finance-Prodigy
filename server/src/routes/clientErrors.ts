import express, { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";

/**
 * INF-02 (owner, session 30): error reports from the app, to our own server, written to the log
 * (Render's logs) and nowhere else. No third-party service.
 *
 * A report carries only the kind of error, its message (already scrubbed by the client:
 * client/lib/errorReport.ts), where in ESSA's scripts it happened, and the page's path. The
 * server scrubs the message again, so a report from an older or altered client can't put a
 * number, an email address or quoted text into the log. Nothing else is logged: no IP, no user
 * agent, no account. Its own parser (8 KB) and limiter (app.ts). Answers 204, or the
 * validation error the app's handler gives.
 */
const router = Router();

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CODE_NAME = /^[A-Za-z_$][\w$]{0,40}$/;
export function scrub(message: string): string {
  const s = message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"()<>]+/gi, "<url>")
    .replace(EMAIL, "<email>")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'([^']*)'/g, (_m, inner: string) => (CODE_NAME.test(inner) ? `'${inner}'` : "'…'"))
    .replace(/`[^`]*`/g, "`…`")
    .replace(/\d[\d.,:]*/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, 200);
}

const reportSchema = z.object({
  kind: z.string().regex(/^[A-Za-z][\w]{0,39}$/),
  message: z.string().max(300),
  where: z.array(z.string().regex(/^\/_next\/[\w./-]{1,160}:\d{1,7}:\d{1,7}$/)).max(6),
  page: z.string().regex(/^\/[\w\-/]{0,99}$/),
}).strict();

// POST /api/client-errors
router.post("/", express.json({ limit: "8kb" }), (req, res, next) => {
  try {
    const r = reportSchema.parse(req.body);
    logger.warn("client_error", { kind: r.kind, message: scrub(r.message), where: r.where, page: r.page });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// A body over 8 KB is refused by the parser above: answered 413 here, quietly (no one reads the
// answer: sendBeacon doesn't), rather than as an unhandled error and its log line.
router.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if ((err as { status?: number } | null)?.status === 413) { res.status(413).end(); return; }
  next(err);
});

export default router;
