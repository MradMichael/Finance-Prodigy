import express, { Router, type ErrorRequestHandler } from "express";
import { logger } from "../lib/logger";

/**
 * POST /api/csp-report -- where browsers send content-policy violation reports
 * (FB-1c, SEC-03). The client's policy names this path in `report-uri` and
 * `Reporting-Endpoints`, and the Vercel rewrite brings it here.
 *
 * MINIMAL BY OWNER DECISION (2026-10-06): one line per report with the ESSA
 * page's path and what was blocked, reduced to its origin or a keyword. Nothing
 * else from the report is kept: not the directive, the policy text, source
 * files, script samples, the referrer or the user agent. No request metadata
 * either. The privacy page ("Security reports") says exactly this.
 *
 * It parses only the two report content types, capped at 8 KB. Anything
 * else is ignored. A refused body is answered quietly: a report endpoint
 * must not turn bad input into error-log lines.
 */
const router = Router();

const MAX_BODY = "8kb";
/** A page with many violations can batch them; more than this from one request is noise or abuse. */
const MAX_REPORTS = 10;
const MAX_PATH = 200;
/** What browsers put in place of a URL when the blocked thing has none. */
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "trusted-types-policy", "trusted-types-sink"]);

router.use(express.json({ type: ["application/csp-report", "application/reports+json"], limit: MAX_BODY }));

/** The page's path only: no query, no fragment, no host. The report tab is about:blank. */
export function pageOf(raw: unknown): string {
  if (raw === "about:blank") return "about:blank";
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:" && url.protocol !== "http:") return "other";
    return url.pathname.slice(0, MAX_PATH);
  } catch {
    return "other";
  }
}

/** What was blocked: a keyword, a scheme with no host worth naming, or an origin. */
export function blockedOf(raw: unknown): string {
  if (typeof raw !== "string") return "other";
  if (KEYWORDS.has(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === "data:") return "data";
    if (url.protocol === "blob:") return "blob";
    if (["https:", "http:", "wss:", "ws:"].includes(url.protocol)) return url.origin;
    return "other";
  } catch {
    return "other";
  }
}

/** Both report shapes, as { page, blocked } pairs of raw values. */
function reportsIn(body: unknown): { page: unknown; blocked: unknown }[] {
  if (Array.isArray(body)) {
    return body
      .filter((r) => r && typeof r === "object" && (r as { type?: unknown }).type === "csp-violation")
      .map((r) => {
        const b = ((r as { body?: unknown }).body ?? {}) as Record<string, unknown>;
        return { page: b.documentURL, blocked: b.blockedURL };
      });
  }
  const legacy = body && typeof body === "object" ? (body as Record<string, unknown>)["csp-report"] : undefined;
  if (legacy && typeof legacy === "object") {
    const r = legacy as Record<string, unknown>;
    return [{ page: r["document-uri"], blocked: r["blocked-uri"] }];
  }
  return [];
}

router.post("/", (req, res) => {
  for (const r of reportsIn(req.body).slice(0, MAX_REPORTS)) {
    logger.info("csp_violation", { page: pageOf(r.page), blocked: blockedOf(r.blocked) });
  }
  res.status(204).end();
});

/** Oversized or malformed bodies: refused, and not logged. */
const quietRefusal: ErrorRequestHandler = (err, _req, res, _next) => {
  res.status((err as { status?: number }).status === 413 ? 413 : 400).end();
};
router.use(quietRefusal);

export default router;
