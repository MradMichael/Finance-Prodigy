"use client";

import { useTheme } from "../contexts/ThemeContext";
import { rateAge } from "../lib/rateAge";
import { fmtCur } from "./screens/shared";

/**
 * Rate staleness, phase 3 (owner-approved 2026-11-05): the LBP rate and how
 * long ago it was last checked, shown where a lira amount is entered -- the
 * moment a stale rate does lasting harm, because the entry is stored with
 * the live rate (withRate) and a later update does not correct it.
 *
 * Reads rateAge, so it is silent exactly when the Currency screen's warning
 * is (fresh, or never edited) and takes the same colours: brass for a nudge,
 * coral when stale. A label only -- confirming or changing the rate stays on
 * the Currency screen.
 *
 * Says "last checked", not "this entry uses": a backdated entry is priced at
 * its own day's rate (rateOn), which need not be today's.
 */
export default function RateAgeChip({ updatedAt, rate }: { updatedAt?: string; rate: number }) {
  const T = useTheme();
  const age = rateAge(updatedAt);
  if (!age || age.level === "fresh") return null;
  return (
    <p data-level={age.level} className="text-[11px] mt-1.5 px-1 font-medium" style={{ color: age.level === "stale" ? T.coral : T.brass }}>
      Rate {fmtCur(rate, "LBP")} per $1, last checked {age.ageDays} days ago.
    </p>
  );
}
