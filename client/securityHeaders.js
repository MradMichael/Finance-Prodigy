/**
 * The security headers every production page carries (FB-1c, SEC-03).
 *
 * PHASE 1 (now): the full content policy is REPORT-ONLY. Violations go to our
 * own server (/api/csp-report, logged as page path plus blocked origin or
 * keyword). It's enforced in phase 2, after 7 days AND once the report tab, a
 * statement import and a service-worker load have each run in real use
 * (owner, 2026-10-06). Phase 2 is ESSA_CSP_ENFORCE=1 locally; in production
 * it's a change to this file.
 *
 * ENFORCED FROM THE FIRST DEPLOY: frame-ancestors, base-uri and object-src,
 * which nothing legitimate here uses, plus X-Frame-Options (older browsers),
 * nosniff, and no-referrer.
 *
 * 'unsafe-inline' IN script-src IS DELIBERATE, AND ITS LIMIT IS REAL. Next.js
 * puts 5 inline scripts on every page, with content that changes per page and
 * per build. Hashes can't follow that, and nonces would make every page render
 * on a server instead of being served static. So an injected inline script
 * RUNS. What the policy still does: no script from another site, no eval, and
 * no sending data elsewhere by fetch, beacon, image, font, frame or form.
 * Every request this app makes is same-origin; the API comes through the
 * /api rewrite. No content policy can stop a script that navigates the tab
 * away with data in the URL. Escaping (FB-1a) stays the first defence. Nonces
 * are a recorded later item.
 *
 * style-src needs 'unsafe-inline' whatever script-src does: the
 * server-rendered pages carry style="..." attributes, from React's inline
 * styles.
 */
const REPORT_PATH = "/api/csp-report";

/** The part enforced from day one. */
const ALWAYS_ENFORCED = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'";

const POLICY = [
  ["default-src", "'self'"],
  ["script-src", "'self' 'unsafe-inline'"],
  ["style-src", "'self' 'unsafe-inline'"],
  ["img-src", "'self'"],
  ["font-src", "'self'"],
  ["connect-src", "'self'"],
  ["worker-src", "'self'"], // the service worker, and pdf.js's statement-reading worker
  ["manifest-src", "'self'"],
  ["frame-src", "'none'"],
  ["form-action", "'self'"],
  ["frame-ancestors", "'none'"],
  ["base-uri", "'none'"],
  ["object-src", "'none'"],
  ["report-uri", REPORT_PATH], // read by browsers without the Reporting API, Firefox among them
  ["report-to", "csp"],
].map(([directive, sources]) => `${directive} ${sources}`).join("; ");

/** @param {{ enforce: boolean }} opts */
function securityHeaders({ enforce }) {
  return [
    ...(enforce
      ? [{ key: "Content-Security-Policy", value: POLICY }]
      : [
          { key: "Content-Security-Policy", value: ALWAYS_ENFORCED },
          { key: "Content-Security-Policy-Report-Only", value: POLICY },
        ]),
    { key: "Reporting-Endpoints", value: `csp="${REPORT_PATH}"` },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
  ];
}

module.exports = { securityHeaders, REPORT_PATH };
