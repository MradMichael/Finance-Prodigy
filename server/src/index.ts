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
import { logger } from "./lib/logger";

const app = express();
// crossOriginResourcePolicy defaults to "same-origin", which would make
// browsers block the client's fetch to this API — the client is always a
// different origin from this server (different port in dev, different
// domain once deployed), so that's the one default this API needs to opt out of.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());

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
  message: { error: "Too many sync requests — please wait a few minutes and try again." },
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
  message: { error: "Too many requests — please wait a few minutes and try again." },
});
app.use("/api/auth", authLimiter, auth);

// Central error handler — Zod issues come back as 422 with details.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(422).json({ error: "Validation failed", issues: err.issues });
  }
  logger.error("unhandled_request_error", err, { method: req.method, path: req.path });
  res.status(500).json({ error: "Something went wrong on our side — your data is safe." });
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => logger.info("server_started", { port: PORT }));
