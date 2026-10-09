// Plan H 5a (session 5): which goals would get a NEGATIVE opening amount at the
// v7 migration -- a stored "saved so far" smaller than the goal's live
// contributions. The migration keeps such a figure as it is (nothing visibly
// jumps); the owner corrects them by hand.
//
// Reads a "Download my data" file. Runs on your machine only; reads nothing
// else and sends nothing anywhere.
//
//   node client/scripts/goal-openings.mjs path/to/essa-data.json
//
// Mirrors addGoalOpenings / negativeGoalOpenings in lib/localData.ts (a test
// keeps the two in step). A contribution in another currency with no stored
// rate is converted at the file's current LBP rate here, and flagged, where
// the migration uses its own cycle's rate.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const round = (n) => Math.round(n * 100) / 100;

export function negativeOpenings(data) {
  const live = (data.transactions ?? []).filter((t) => t.goalId && t.deletedAt == null && t.purgedAt == null);
  const out = [];
  for (const g of data.goals ?? []) {
    let approx = false;
    const contributions = round(live.filter((t) => t.goalId === g.id).reduce((s, t) => {
      if (t.goalAmount != null) return s + t.goalAmount;
      if (t.currency === g.currency) return s + t.amount;
      const rate = t.lbpRateAtEntry ?? (approx = true, data.lbpRate ?? 89_500);
      return s + (g.currency === "LBP" ? t.amount * rate : t.amount / rate);
    }, 0));
    const openingAmount = g.openingAmount ?? round(g.currentAmount - contributions);
    if (openingAmount < 0) out.push({ id: g.id, name: g.name, currency: g.currency, storedTotal: g.currentAmount, contributions, openingAmount, ...(approx ? { approximate: true } : {}) });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node client/scripts/goal-openings.mjs <essa-data.json>"); process.exit(2); }
  const rows = negativeOpenings(JSON.parse(readFileSync(file, "utf8")));
  if (!rows.length) console.log("No goal would get a negative opening amount.");
  for (const r of rows) {
    console.log(`${r.name} (${r.currency}): saved so far ${r.storedTotal}, live contributions ${r.contributions}, opening amount ${r.openingAmount}${r.approximate ? "  [approximate: a contribution in another currency has no stored rate]" : ""}`);
  }
}
