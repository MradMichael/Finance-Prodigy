import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";

/**
 * SEC-04 / R1: whose allowance a request counts against.
 *
 * The app's requests reach this server through the site's own proxy route, so the address Express sees
 * (`req.ip`: the right-most X-Forwarded-For entry under `trust proxy 1`) is the proxy's, the same for everyone.
 * The route names the person's address in `x-essa-client-ip`, and this server believes it only when the request
 * also carries the secret both sides hold (`ESSA_PROXY_KEY`) in `x-essa-proxy-key`.
 *
 * Someone calling this server directly doesn't have the secret, so whatever they put in `x-essa-client-ip` is
 * ignored and they are keyed on the address that connected, as before. `trust proxy` stays 1: raising it would
 * believe a direct caller's own X-Forwarded-For.
 *
 * - The secret is compared in constant time (digests of equal length), so a guess learns nothing from timing.
 * - A secret shorter than 32 characters is not used: it would be guessable. Unset or empty, the header is never
 *   believed and every request is keyed on `req.ip`, exactly as before this existed.
 * - The address must be one valid IPv4 or IPv6 address; a list, a port or anything else is refused.
 * - Neither header's value is logged or echoed.
 */
const MIN_SECRET = 32;
const digest = (s: string) => createHash("sha256").update(s).digest();

function fromOurProxy(req: Request): boolean {
  const secret = process.env.ESSA_PROXY_KEY ?? "";
  if (secret.length < MIN_SECRET) return false;
  const given = req.get("x-essa-proxy-key");
  if (typeof given !== "string" || given.length === 0) return false;
  return timingSafeEqual(digest(given), digest(secret));
}

/** The address a request's limits count against: the person's, when our proxy names it; else the one that connected. */
export function clientAddress(req: Request): string {
  if (fromOurProxy(req)) {
    const named = (req.get("x-essa-client-ip") ?? "").trim();
    if (isIP(named) !== 0) return named;
  }
  return req.ip ?? "";
}

/** express-rate-limit's key for a request: its client address (an IPv6 address by its /56, the library's own rule). */
export function limiterKey(req: Request): string {
  return ipKeyGenerator(clientAddress(req));
}
