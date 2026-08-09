/**
 * MOMENTUM — API server
 * npm run dev → http://localhost:4000
 */
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import sync from "./routes/sync";
import auth from "./routes/auth";
import events from "./routes/events";
import { logger } from "./lib/logger";

// Every current route is disciplined about try/catch + next(err), but that
// only covers errors thrown inside a request's own call stack. An error
// from something outside one (a stray unawaited promise, an async callback
// with no catch) has no Express error handler to reach — without this,
// it would crash the whole process silently (Node's default since v15)
// and take every user's sync down until the platform restarts it, with no
// log line explaining why. Logging then exiting (rather than trying to
// keep serving) is deliberate: after an uncaught error the process is in
// an unknown state, and Railway restarts it immediately either way.
process.on("uncaughtException", (err) => {
  logger.error("uncaught_exception", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", reason);
  process.exit(1);
});

const app = express();
// Railway (like most PaaS hosts) puts exactly one reverse proxy in front of
// this process. Without this, express-rate-limit's default keyGenerator
// (req.ip) resolves to that proxy's own address for every request — every
// real user collapses onto the SAME rate-limit bucket, turning "100 sync
// requests per user per 15 min" into "100 total for the whole app." Trusting
// exactly one hop (not `true`, which would trust an unbounded chain and let
// a client spoof X-Forwarded-For) is the correct setting for this topology.
app.set("trust proxy", 1);
// crossOriginResourcePolicy defaults to "same-origin", which would make
// browsers block the client's fetch to this API — the client is always a
// different origin from this server (different port in dev, different
// domain once deployed), so that's the one default this API needs to opt out of.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000" }));
// express.json()'s own default limit (100kb) is well under sync.ts's
// documented 2MB payload cap — without raising it here, any push over
// ~100KB never reaches that check at all; body-parser rejects it first
// with a raw, unfriendly 413. This just moves the actual cutoff to where
// the zod validation (and its clear error message) already expects it.
app.use(express.json({ limit: "3mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "momentum-api" }));

// Generous enough for normal auto-sync usage (debounced client-side, so a
// real user isn't hammering this), tight enough to bound brute-forcing a
// sync token via repeated /pull attempts or hammering /push. Tune once
// real usage patterns are known.
const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sync requests. Please wait a few minutes and try again." },
});
app.use("/api/sync", syncLimiter, sync);

// Tighter than the sync limiter — this is an email-existence check, which
// is inherently an enumeration surface (the response itself reveals
// whether an email has synced data), so it's worth bounding harder even
// though a legitimate user only ever triggers it once per sign-up attempt.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});
app.use("/api/auth", authLimiter, auth);

// Separate instance from authLimiter, even though the settings match today —
// express-rate-limit keys purely on IP, not path, so sharing one middleware
// instance across two routes meant they silently drew from the same 30
// req/15 min bucket. On a shared IP (office NAT, campus network), onboarding
// event pings could burn down the budget check-email needs, 429-ing a
// legitimate sign-up attempt for a reason that had nothing to do with it.
const eventsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});
app.use("/api/events", eventsLimiter, events);

// Central error handler — Zod issues come back as 422 with details.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(422).json({ error: "Validation failed", issues: err.issues });
  }
  // express.json() throws a SyntaxError for a malformed request body (bad
  // JSON) — that's a client mistake, not a server fault, so it should come
  // back as a 400 like the validation errors above, not a generic 500.
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Malformed JSON in request body." });
  }
  logger.error("unhandled_request_error", err, { method: req.method, path: req.path });
  res.status(500).json({ error: "Something went wrong on our side. Your data is safe." });
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => logger.info("server_started", { port: PORT }));
