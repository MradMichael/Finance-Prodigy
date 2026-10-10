// Session 10, item 2 (HELD: wording awaits the owner). Another device ran
// "Reset all data", and this device's merge clears what it held. Until now
// the merge said nothing (app/page.reset-elsewhere.test.tsx). Drafted from
// the owner's example; pinned verbatim in resetNotice.test.ts.
import { dayLabel } from "./period";

/** The other device's reset, as the merge that takes it reports it: when, and whether anything made here was kept. */
export interface ResetElsewhere { at: string; kept: boolean }

/**
 * DRAFT R1 (nothing kept): "Your other device reset all data on 9 Oct 2026.
 * This device now matches it."
 * DRAFT R2 (something made here since this device's last sync was kept):
 * "... This device now matches it, except for changes made here that hadn't
 * been backed up yet."
 */
export const RESET_ELSEWHERE_SENTENCE = (r: ResetElsewhere): string =>
  `Your other device reset all data on ${dayLabel(new Date(r.at))}. This device now matches it` +
  (r.kept ? ", except for changes made here that hadn't been backed up yet." : ".");
