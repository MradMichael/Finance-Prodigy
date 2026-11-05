// Phase 2.8.5d: what the merge notice says about two devices' corrections to
// one account (lib/concurrentCorrections.ts).
//
// 2.8.5e: APPROVED by the owner. Sentences 1-4 (later, later without figures,
// same, close) as drafted (session 42); the crossed sentences (5, 6) on the
// owner's pattern (session 43): no signed figure, the action named by account
// and direction (movementPhrase).
// lib/concurrent-corrections.merge.test.ts pins every sentence, so changing
// one is deliberate.
import type { CorrectionClash } from "./concurrentCorrections";
import { noticeMoney } from "./noticeMoney";

/** The account as a sentence names it: the noun the other merge sentences use for a goal or debt. */
function nounOf(c: Pick<CorrectionClash, "account" | "name">): string {
  if (c.account === "ef") return "your safety net";
  return `the ${c.account === "debt" ? "debt" : "goal"} "${c.name}"`;
}

/**
 * 2.8.5e (owner-approved, session 43): what the other device recorded, named
 * by the account and the way it moved the balance, never as a signed figure.
 * A contribution raises a goal; a payment lowers a debt; a deposit raises the
 * safety net and a withdrawal lowers it. The other way (a debt raised, a goal
 * lowered), or movements in both directions, is "an increase of" / "a
 * decrease of" the net change. Several in one direction: a count and a total.
 * Each direction is re-derived from real rows in concurrent-corrections.test.ts.
 */
function movementPhrase(c: Pick<CorrectionClash, "account" | "currency" | "moved" | "movedCount" | "movedDirection">): string {
  const moved = c.moved ?? 0;
  const total = noticeMoney(Math.abs(moved), c.currency);
  const named = c.movedDirection === "mixed" ? null
    : c.account === "goal" ? (c.movedDirection === "up" ? "contribution" : null)
    : c.account === "debt" ? (c.movedDirection === "down" ? "payment" : null)
    : c.movedDirection === "up" ? "deposit" : "withdrawal";
  if (named == null) return moved > 0 ? `an increase of ${total}` : `a decrease of ${total}`;
  const n = c.movedCount ?? 1;
  return n === 1 ? `a ${named} of ${total}` : `${n} ${named}s totalling ${total}`;
}

/** One clash, as the notice says it. Figures in the account's own currency. */
export function correctionSentence(c: Omit<CorrectionClash, "id">): string {
  const noun = nounOf(c);
  const money = (n: number) => noticeMoney(n, c.currency);
  switch (c.how) {
    case "later":
      return c.kept != null && c.other != null
        ? `Both devices corrected ${noun} — kept the later figure, ${money(c.kept)} (the other device said ${money(c.other)}). The other correction is in Recently deleted.`
        : `Both devices corrected ${noun} — kept the later correction. The other one is in Recently deleted.`;
    case "same":
      return `Both devices corrected ${noun} to ${money(c.kept!)} — kept one; the duplicate is in Recently deleted.`;
    case "close":
      return `Both devices corrected ${noun}, and one of the corrections belongs to a closed cycle, so ESSA kept both: it now shows ${money(c.result!)}. If that's wrong, correct it once more.`;
    case "crossed":
      return c.kept != null
        ? `One device set ${noun} to ${money(c.kept)} while the other recorded ${movementPhrase(c)}. ESSA kept both, so it now shows ${money(c.result!)}. If ${money(c.kept)} was right, correct it once more.`
        : `One device corrected ${noun} while the other recorded ${movementPhrase(c)}. ESSA kept both, so it now shows ${money(c.result!)}. If that's wrong, correct it once more.`;
  }
}
