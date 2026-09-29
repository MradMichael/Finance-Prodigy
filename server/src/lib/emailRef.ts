/**
 * Keyed references for email addresses in log lines (audit 2.4.165).
 *
 * A log line needs to say "these three refused pulls were the same account"
 * without saying which account. A plain SHA-256 of the address looks
 * anonymous and is not: plausible addresses are few enough to hash them all
 * and match. So the reference is an HMAC-SHA256 under a secret the server
 * holds (LOG_EMAIL_KEY). Without that key, a line can't be matched back to
 * an address by guessing. WITH it -- and the server has it -- a candidate
 * address can be checked. So this is not "irreversible", and nothing here or
 * on the privacy page may say it is.
 *
 * NO KEY, NO REFERENCE. When LOG_EMAIL_KEY is missing or unusable, every
 * reference is the literal "unkeyed": never the address, never an unkeyed
 * hash. Accounts can't be told apart in the logs until the key is set. That
 * is the intended failure, not something to fall back from.
 *
 * Rotating the key breaks correlation between lines written before and
 * after. Accepted.
 */
import { createHmac } from "crypto";

export const UNKEYED = "unkeyed";

/** 16 hex characters = 64 bits of the HMAC: enough to tell accounts apart in a log. */
const REF_HEX_CHARS = 16;

/**
 * At least 32 characters, no whitespace. 32 random bytes is 64 characters as
 * hex and 44 as base64; both pass. A value with a space or a trailing newline
 * is refused rather than trimmed, so a paste error shows up as the startup
 * warning instead of silently becoming a key nobody meant.
 */
const MIN_KEY_CHARS = 32;

export type LogKeyStatus = "ok" | "missing" | "malformed";

export function logKeyStatus(): LogKeyStatus {
  const raw = process.env.LOG_EMAIL_KEY;
  if (raw === undefined || raw === "") return "missing";
  if (raw.length < MIN_KEY_CHARS || /\s/.test(raw)) return "malformed";
  return "ok";
}

/** The address's keyed reference, after the same trim + lower-case emailSchema applies. */
export function emailRef(email: string): string {
  if (logKeyStatus() !== "ok") return UNKEYED;
  return createHmac("sha256", process.env.LOG_EMAIL_KEY as string)
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, REF_HEX_CHARS);
}

/**
 * Address-shaped text, replaced by its reference. The logger runs every
 * string in every line through this, as the backstop behind the call sites:
 * the routes log `emailRef` explicitly, and this catches an address that
 * reaches a line some other way -- a future `{ email }`, or an error message
 * that quotes one.
 *
 * The local part is limited to the characters zod's email check accepts
 * (letters, digits, . _ ' + -, plus %), so a path like
 * node_modules/@prisma/client in a stack trace is not taken for an address.
 * It does NOT catch an address that isn't address-shaped, such as a
 * URL-encoded one (%40). The route tests are the check on the routes; this
 * is not a substitute for them.
 */
const ADDRESS = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

export function scrubAddresses(text: string): string {
  return text.replace(ADDRESS, (address) => `[email:${emailRef(address)}]`);
}
