// Session 10, item 2; R1 and R2 approved by the owner (session 11). Another
// device ran "Reset all data", and this device's merge clears what it held:
// its items, and (session 11) its settings. Until session 10 the merge said
// nothing. Pinned verbatim in reset-elsewhere.test.ts.
import { dayLabel } from "./period";

/** The other device's reset, as the merge that takes it reports it: when, and whether anything made here was kept. */
export interface ResetElsewhere { at: string; kept: boolean }

/**
 * R1 (nothing of this device's own kept): "Your other device reset all
 * data on 9 Oct 2026. This device now matches it."
 * R2 (something of this device's own kept: an item it held that the reset
 * didn't know, or a setting changed here after the reset):
 * "... This device now matches it, except for changes made here that hadn't
 * been backed up yet."
 */
export const RESET_ELSEWHERE_SENTENCE = (r: ResetElsewhere): string =>
  `Your other device reset all data on ${dayLabel(new Date(r.at))}. This device now matches it` +
  (r.kept ? ", except for changes made here that hadn't been backed up yet." : ".");
