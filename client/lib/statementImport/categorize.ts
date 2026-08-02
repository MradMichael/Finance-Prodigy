import type { Bucket } from "./neoBankAudiParser";

/**
 * Best-effort keyword guess for a bucket, shown pre-filled in the import
 * review screen — never saved without going through that review, so this
 * only has to be a reasonable starting point, not correct.
 */
const NEEDS_KEYWORDS = [
  "TOTAL", "IPT", "GAS", "FUEL", "PETROL", "STATION",
  "SPINNEYS", "CARREFOUR", "STORE", "MARKET", "SUPERMARKET",
  "PHARMACY", "PHARMACIE", "CLINIC", "HOSPITAL",
];

const WANTS_KEYWORDS = [
  "MOULIN", "CHOCOLA", "SOURDOUGH", "CHARCUTIER", "BAKERY", "CAFE", "COFFEE",
  "RESTAURANT", "CHICKEN", "KARAM", "BEAN", "DIGITAL", "CINEMA", "BAR",
];

export function guessBucket(description: string): Bucket {
  const upper = description.toUpperCase();
  if (NEEDS_KEYWORDS.some((kw) => upper.includes(kw))) return "NEEDS";
  if (WANTS_KEYWORDS.some((kw) => upper.includes(kw))) return "WANTS";
  return "WANTS"; // unmatched default — the safer "review me" bucket, since review is mandatory anyway
}
