// Checks run on an amount before it is stored (session 42, owner-approved).

/**
 * Below this many lira, an entry is more likely a USD amount typed with the
 * currency left on LBP (L£400 is about $0.004). Tuned to LBP's ~89,500/USD
 * magnitude; Phase 9-N makes this currency-relative (docs/ROADMAP.md), and
 * that change belongs here, in the one place every entry path asks.
 */
export const LBP_MISTYPE_THRESHOLD = 500;

/** Whether to ask "did you mean USD?" before storing this amount. */
export function looksLikeMistypedLbp(amount: number, currency: string): boolean {
  return currency === "LBP" && amount < LBP_MISTYPE_THRESHOLD;
}
