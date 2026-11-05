// Phase 2.8.5d: what the merge notice says about two devices' corrections to
// one account (lib/concurrentCorrections.ts).
//
// DRAFT WORDING (session 42), NOT APPROVED. 2.8.5e is the owner's approval of
// these sentences; until then this branch is held and must not merge.
// lib/concurrent-corrections.merge.test.ts pins every sentence, so changing
// one is deliberate.
import type { CorrectionClash } from "./concurrentCorrections";
import { noticeMoney } from "./noticeMoney";

/** The account as a sentence names it: the noun the other merge sentences use for a goal or debt. */
function nounOf(c: Pick<CorrectionClash, "account" | "name">): string {
  if (c.account === "ef") return "your safety net";
  return `the ${c.account === "debt" ? "debt" : "goal"} "${c.name}"`;
}

const signed = (amount: number, currency: string) => `${amount < 0 ? "−" : "+"}${noticeMoney(Math.abs(amount), currency)}`;

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
        ? `One device set ${noun} to ${money(c.kept)} while the other recorded a change of ${signed(c.moved!, c.currency)}. ESSA kept both, so it now shows ${money(c.result!)}. If ${money(c.kept)} was right, correct it once more.`
        : `One device corrected ${noun} while the other recorded a change of ${signed(c.moved!, c.currency)}. ESSA kept both, so it now shows ${money(c.result!)}. If that's wrong, correct it once more.`;
  }
}
