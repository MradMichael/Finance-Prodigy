// COPY-03: Journey's spending-mix line said "You're putting more of every
// dollar to work…" when the savings share was the same as at the start (a
// tie took the "more" branch), and said nothing about wants rising then.
// Both sentences are the screen's own, unchanged: "more" only when the
// savings share actually grew; "Wants crept up…" when it fell, or held while
// wants grew; neither when nothing moved.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import JourneyScreen from "./JourneyScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 6, 15)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const MORE = "You're putting more of every dollar to work for your future than when you started.";
const CREPT = "Wants crept up a little. Not a crisis, just a pattern worth noticing next time you log a purchase.";
const tx = (id: string, bucket: StoredTransaction["bucket"], amount: number, date: string) =>
  ({ id, amount, currency: "USD", bucket, description: id, date }) as StoredTransaction;
function show(transactions: StoredTransaction[]) {
  const data = { ...DEFAULT_DATA, income: 1000, budgetRule: "50-30-20", transactions } as LocalFinancials;
  render(<JourneyScreen financials={data} dashData={computeDashboard(data)} onNavigate={vi.fn()} />);
  return document.body.textContent ?? "";
}

it("savings share unchanged, wants up: not 'more'; wants crept up", () => {
  // June: needs only (wants 0%, savings 0%). July: wants 33%, savings still 0%.
  const text = show([tx("j1", "NEEDS", 100, "2026-06-10"), tx("y1", "NEEDS", 100, "2026-07-05"), tx("y2", "WANTS", 50, "2026-07-06")]);
  expect(text).toContain("and Savings from 0% to 0%");
  expect(text).not.toContain(MORE);
  expect(text).toContain(CREPT);
});

it("nothing moved: neither sentence", () => {
  const text = show([tx("j1", "NEEDS", 100, "2026-06-10"), tx("y1", "NEEDS", 200, "2026-07-05")]);
  expect(text).toContain("Wants went from 0% of your spending to 0%");
  expect(text).not.toContain(MORE);
  expect(text).not.toContain(CREPT);
});

it("savings share grew: 'more' (unchanged)", () => {
  const text = show([tx("j1", "NEEDS", 100, "2026-06-10"), tx("y1", "NEEDS", 100, "2026-07-05"), tx("y2", "SAVINGS", 100, "2026-07-06")]);
  expect(text).toContain(MORE);
  expect(text).not.toContain(CREPT);
});

it("savings share fell: wants crept up (unchanged)", () => {
  const text = show([tx("j1", "NEEDS", 100, "2026-06-10"), tx("j2", "SAVINGS", 100, "2026-06-11"), tx("y1", "NEEDS", 100, "2026-07-05")]);
  expect(text).toContain(CREPT);
  expect(text).not.toContain(MORE);
});
