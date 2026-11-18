// Checks run on an amount before it is stored (session 42, owner-approved).

/**
 * Below this many lira, an entry is more likely a USD amount typed with the
 * currency left on LBP (L£400 is about $0.004). Tuned to LBP's ~89,500/USD
 * magnitude; Phase 9-N makes this currency-relative (docs/ROADMAP.md), and
 * that change belongs here, in the one place every entry path asks.
 */
export const LBP_MISTYPE_THRESHOLD = 500;

/**
 * An entry's description as stored: what was typed, trimmed, or the type's own name when nothing was ("Needs",
 * "Transfer"). D-a (owner, session 56): the entry form and the edit sheet both call this, so a blank description
 * can't be refused in one place and named in the other again.
 */
export function entryDescription(typed: string, bucket: string): string {
  return typed.trim() || bucket.charAt(0) + bucket.slice(1).toLowerCase();
}

/** Whether to ask "did you mean USD?" before storing this amount. */
export function looksLikeMistypedLbp(amount: number, currency: string): boolean {
  return currency === "LBP" && amount < LBP_MISTYPE_THRESHOLD;
}
