import { addMonths } from "./debtEngine";
import { dateFmt } from "./computeDashboard";

export interface PaceProjection {
  /** null when monthlyRate <= 0 and there's still a gap to close — no finite date exists at that rate. */
  months: number | null;
  dateDisplay: string | null;
}

/**
 * Months (and calendar date) to close a dollar gap at a flat monthly rate.
 * Shared by the Projections page's emergency-fund and goal "what if I added
 * $X/month" scenarios, which are otherwise the same math against different
 * numbers. Already-met (remaining <= 0) reads as 0 months, today, rather
 * than running the division.
 */
export function projectCompletion(remaining: number, monthlyRate: number, asOf: Date = new Date()): PaceProjection {
  if (remaining <= 0) return { months: 0, dateDisplay: dateFmt(asOf) };
  if (monthlyRate <= 0) return { months: null, dateDisplay: null };
  const months = Math.ceil(remaining / monthlyRate);
  return { months, dateDisplay: dateFmt(addMonths(asOf, months)) };
}
