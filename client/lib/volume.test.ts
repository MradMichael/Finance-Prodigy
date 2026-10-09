// TEST-06: apart from DI-07's save, load, encrypt and base64 tests, nothing
// ran at a realistic size, though DI-07 itself hid until 486 transactions.
// These run the paths the audit named at 15,000 transactions (about Edge's
// storage quota, INF-M1) and check what each computes, not how fast: a size
// test, not a speed test, so each has its own generous time limit.
//
// Covered: the dashboard's cycle totals, the transaction merge, the 30-day
// purge, and the print report's ledger. Statement import at size is not here:
// its duplicate check lives inside the component (ImportStatement's
// buildReviewRows), which would need a long rendered review to reach.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboard } from "./computeDashboard";
import { buildReportHtml } from "./printReport";
import { DEFAULT_DATA, mergeTransactions, autoPurgeExpired, type LocalFinancials, type StoredTransaction } from "./localData";

const N = 15_000;
const LIMIT = 60_000;
const BUCKETS = ["NEEDS", "WANTS", "SAVINGS", "INCOME"] as const;
const START = Date.UTC(2024, 10, 1); // 1 Nov 2024 ... 20 Oct 2026, about 21 a day
const DAYS = 719;
const iso = (dayIndex: number) => new Date(START + dayIndex * 86_400_000).toISOString().slice(0, 10);

/** N transactions, whole dollars so every sum is exact, spread over two years. */
function many(): StoredTransaction[] {
  return Array.from({ length: N }, (_, i) => ({
    id: `t${i}`, amount: 1 + (i % 97), currency: "USD", bucket: BUCKETS[i % 4], description: `row-${i}`,
    date: iso(i % (DAYS + 1)), updatedAt: "2026-10-01T09:00:00.000Z",
  }) as StoredTransaction);
}
const sum = (xs: StoredTransaction[]) => xs.reduce((s, t) => s + t.amount, 0);

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12)); });
afterEach(() => { vi.useRealTimers(); });

describe("at 15,000 transactions", () => {
  it("the dashboard's cycle totals count every transaction in the cycle, and nothing outside it", () => {
    const txs = many();
    const data = { ...DEFAULT_DATA, income: 3000, transactions: txs } as LocalFinancials;
    const inCycle = txs.filter((t) => t.date >= "2026-10-01" && t.date <= "2026-10-20");
    expect(inCycle.length).toBeGreaterThan(300);
    const dash = computeDashboard(data);
    expect(dash.month.needsSpend).toBe(sum(inCycle.filter((t) => t.bucket === "NEEDS")));
    expect(dash.month.wantsSpend).toBe(sum(inCycle.filter((t) => t.bucket === "WANTS")));
    expect(dash.month.savingsContrib).toBe(sum(inCycle.filter((t) => t.bucket === "SAVINGS")));
  }, LIMIT);

  it("the merge keeps every transaction from both sides once, and a deletion on either side outranks the live copy", () => {
    const txs = many();
    const local = txs.slice(0, 10_000);
    // The server holds the last 10,000; 1,000 of the 5,000 both hold were deleted there.
    const server = txs.slice(5_000).map((t, i) => (i < 1_000 ? { ...t, deletedAt: "2026-10-10T09:00:00.000Z" } : t));
    const r = mergeTransactions(local, server);
    expect(r.transactions.length).toBe(N);
    expect(new Set(r.transactions.map((t) => t.id)).size).toBe(N);
    expect(r.addedFromServer).toBe(5_000);
    expect(r.transactions.filter((t) => t.deletedAt != null).map((t) => t.id).sort())
      .toEqual(txs.slice(5_000, 6_000).map((t) => t.id).sort());
  }, LIMIT);

  it("the 30-day purge removes every deleted row past its window, and only those", () => {
    const txs = many().map((t, i) => (i % 5 === 0 ? { ...t, deletedAt: "2026-09-01T09:00:00.000Z" } : i % 5 === 1 ? { ...t, deletedAt: "2026-10-15T09:00:00.000Z" } : t));
    const out = autoPurgeExpired(txs, new Date(2026, 9, 20, 12));
    expect(out.length).toBe(N);
    const purged = out.filter((t) => t.purgedAt != null);
    expect(purged.length).toBe(N / 5);
    expect(new Set(purged.map((t) => Number(t.id.slice(1)) % 5))).toEqual(new Set([0]));
    expect(out.filter((t) => t.deletedAt != null && t.purgedAt == null).length).toBe(N / 5);
  }, LIMIT);

  it("the detailed print report lists every live transaction, with the total of what was spent", () => {
    const txs = many().map((t, i) => (i % 50 === 7 ? { ...t, deletedAt: "2026-10-15T09:00:00.000Z" } : t));
    const live = txs.filter((t) => t.deletedAt == null);
    const data = { ...DEFAULT_DATA, income: 3000, transactions: txs } as LocalFinancials;
    const html = buildReportHtml("U", data, computeDashboard(data), { detailed: true });
    expect(html).toContain(`${live.length} entries`);
    const spent = sum(live.filter((t) => t.bucket !== "INCOME"));
    expect(html).toContain(`$${spent.toLocaleString("en-US")}`);
    expect(html.split("<tr>").length - 1).toBeGreaterThanOrEqual(live.length);
    expect(html).toContain(">row-0<");
    expect(html).toContain(`>row-${N - 1}<`);
    expect(html).not.toContain(">row-7<"); // a deleted one
  }, LIMIT);
});
