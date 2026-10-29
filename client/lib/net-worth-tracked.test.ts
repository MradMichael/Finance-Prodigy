// DI-06 (owner, session 30, DECISIONS_PENDING entry 2 (a)): net worth = safety
// net + goals + assets + tracked balances − debts, everywhere it shows. A
// tracked balance counts at its current balance, as Balance Check's "Expected
// now" shows it; a lira one is valued at today's rate, like every held lira
// figure. The currency screen's holdings count the same figure.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboard, computeHoldingsByCurrency } from "./computeDashboard";
import { buildReportHtml } from "./printReport";
import { DEFAULT_DATA, type LocalFinancials, type StoredAsset, type StoredDebt, type StoredTransaction, type TrackedBalance } from "./localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 14, 12, 0)); });
afterEach(() => { vi.useRealTimers(); });

const asset = (value: number): StoredAsset => ({ id: "a1", name: "Car", value, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }) as StoredAsset;
const debt = (balance: number): StoredDebt => ({ id: "d1", name: "Card debt", balance, openingBalance: balance, apr: 20, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }) as StoredDebt;
const bank = (startingBalance: number, extra: Partial<TrackedBalance> = {}): TrackedBalance =>
  ({ id: "tb-bank", name: "Bank", paymentMethod: "card", cardId: "c1", startingBalance, startingDate: "2026-10-01", currency: "USD", ...extra });
const liraCash = (startingBalance: number, extra: Partial<TrackedBalance> = {}): TrackedBalance =>
  ({ id: "tb-cash", name: "Cash", paymentMethod: "cash", startingBalance, startingDate: "2026-09-01", currency: "LBP", ...extra });
const spend = (amount: number, date = "2026-10-05"): StoredTransaction =>
  ({ id: `t-${amount}-${date}`, amount, currency: "USD", bucket: "WANTS", description: "Groceries", date, paymentMethod: "card", cardId: "c1", createdAt: `${date}T10:00:00.000Z` }) as StoredTransaction;

const dash = (patch: Partial<LocalFinancials>) => computeDashboard({ ...DEFAULT_DATA, ...patch } as LocalFinancials);

describe("DI-06: tracked balances are in net worth", () => {
  it("the write-up's example: $3,000 tracked, a $2,000 debt: +$1,000 (it was −$2,000)", () => {
    const nw = dash({ income: 1000, trackedBalances: [bank(3000)], debts: [debt(2000)] }).netWorth;
    expect(nw.total).toBe(1000);
    expect(nw.assets).toBe(3000);
    expect(nw.liabilities).toBe(2000);
  });

  it("lira cash only, L£179,000,000 at 89,500: $2,000 (it was $0)", () => {
    const nw = dash({ income: 1000, lbpRate: 89_500, trackedBalances: [liraCash(179_000_000)] }).netWorth;
    expect(nw.total).toBe(2000);
  });

  it("counts the current balance, not the last check: spending since reduces it", () => {
    const nw = dash({ income: 1000, trackedBalances: [bank(2000)], transactions: [spend(1800)] }).netWorth;
    expect(nw.total).toBe(200);
  });

  it("a lira balance is valued at today's rate after the rate moves (L£89,500,000: $1,000 at 89,500, $895 at 100,000)", () => {
    const nw = dash({
      income: 1000,
      lbpRate: 100_000,
      lbpRateLog: [{ from: "2026-01-01", value: 89_500 }, { from: "2026-10-10", value: 100_000 }],
      trackedBalances: [liraCash(89_500_000)],
    }).netWorth;
    expect(nw.total).toBe(895);
  });

  it("an overspent pool (below zero) is a liability, not negative assets", () => {
    const nw = dash({ income: 1000, assets: [asset(1000)], trackedBalances: [bank(0)], transactions: [spend(400)] }).netWorth;
    expect(nw.assets).toBe(1000);
    expect(nw.liabilities).toBe(400);
    expect(nw.total).toBe(600);
  });

  it("this month's point on the trend (the snapshot page.tsx stores) carries the new total", () => {
    const d = dash({ income: 1000, trackedBalances: [bank(3000)], debts: [debt(2000)] });
    expect(d.netWorthTrend[d.netWorthTrend.length - 1]).toEqual({ ym: "2026-10", value: 1000 });
  });

  it("the report's net worth line reads the same total", () => {
    const data = { ...DEFAULT_DATA, income: 1000, trackedBalances: [bank(3000)], debts: [debt(2000)] } as LocalFinancials;
    const html = buildReportHtml("Quartz Runner", data, computeDashboard(data));
    expect(html).toContain('<div class="label">Net worth</div><div class="value">$1,000');
  });
});

// The owner asked for the list in the tests: whose tier moves when tracked
// balances join net worth. Each profile's tier without its tracked balances
// (the old definition) and with them.
describe("DI-06: whose tier moves", () => {
  const tierOf = (p: Partial<LocalFinancials>) => dash(p).netWorth.tier;
  const PROFILES: { who: string; data: Partial<LocalFinancials>; before: string | null; after: string | null }[] = [
    { who: "a $3,000 bank balance and a $2,000 card debt, $1,000 a month", data: { income: 1000, trackedBalances: [bank(3000)], debts: [debt(2000)] }, before: "Closing the gap", after: "Foundation builder" },
    { who: "lira cash only (L£179,000,000), $1,000 a month", data: { income: 1000, lbpRate: 89_500, trackedBalances: [liraCash(179_000_000)] }, before: "Breaking even", after: "Foundation builder" },
    { who: "a $3,500 debt and a $600 bank balance, $1,500 a month", data: { income: 1500, trackedBalances: [bank(600)], debts: [debt(3500)] }, before: "Rebuilding", after: "Closing the gap" },
    { who: "a $1,600 asset and a card pool overspent by $400, $1,500 a month", data: { income: 1500, assets: [asset(1600)], trackedBalances: [bank(0)], transactions: [spend(400)] }, before: "Foundation builder", after: "Breaking even" },
    { who: "a $4,000 asset and a $50 wallet, $1,500 a month", data: { income: 1500, assets: [asset(4000)], trackedBalances: [bank(50)] }, before: "Foundation builder", after: "Foundation builder" },
    { who: "a $12,000 debt and a $1,000 bank balance, $1,500 a month", data: { income: 1500, trackedBalances: [bank(1000)], debts: [debt(12000)] }, before: "Heavy debt load", after: "Heavy debt load" },
    { who: "no tracked balances at all", data: { income: 1500, assets: [asset(4841)] }, before: "Foundation builder", after: "Foundation builder" },
    { who: "no income set (no tier either way)", data: { income: 0, trackedBalances: [bank(3000)] }, before: null, after: null },
  ];
  for (const p of PROFILES) {
    it(`${p.who}: ${p.before ?? "no tier"} → ${p.after ?? "no tier"}${p.before === p.after ? " (doesn't move)" : " (moves)"}`, () => {
      expect(tierOf({ ...p.data, trackedBalances: [] }), "without tracked balances").toBe(p.before);
      expect(tierOf(p.data), "with tracked balances").toBe(p.after);
    });
  }
});

describe("DI-06: the currency screen's holdings count the same current figure", () => {
  it("spending since the check reduces holdings (they counted the last confirmed figure)", () => {
    const data = { ...DEFAULT_DATA, trackedBalances: [bank(2000, { actualBalance: 2000, actualBalanceDate: "2026-10-01T09:00:00.000Z" })], transactions: [spend(1800)] } as LocalFinancials;
    expect(computeHoldingsByCurrency(data, 89_500).usdAssets).toBe(200);
  });

  it("a lira balance's holding is its figure in lira (Balance Check's \"Expected now\")", () => {
    const data = { ...DEFAULT_DATA, lbpRate: 89_500, trackedBalances: [liraCash(89_500_000)] } as LocalFinancials;
    const h = computeHoldingsByCurrency(data, 89_500);
    expect(h.lbpAssets).toBe(89_500_000);
    expect(h.holdingsTotalUSD).toBe(1000);
  });
});

// Found while building DI-06: a lira balance's figure was converted to lira
// from dollars already rounded to the cent, so it read up to half a cent's
// worth out (L£447 at 89,500): a L£100,000 wallet read L£100,240 as "Expected
// now". The lira figure is now built from the unrounded ledger figure.
describe("DI-06: a lira figure isn't rounded through dollar cents first", () => {
  const cashLBP = (amount: number): StoredTransaction =>
    ({ id: `c-${amount}`, amount, currency: "LBP", bucket: "WANTS", description: "Bakery", date: "2026-10-05", paymentMethod: "cash", createdAt: "2026-10-05T10:00:00.000Z" }) as StoredTransaction;

  it("a L£100,000 wallet with nothing spent reads L£100,000 (it read L£100,240)", () => {
    expect(dash({ lbpRate: 89_500, trackedBalances: [liraCash(100_000)] }).balanceChecks[0].nowNative).toBe(100_000);
  });

  it("L£5,000,000 less L£1,234,567 spent reads L£3,765,433", () => {
    expect(dash({ lbpRate: 89_500, trackedBalances: [liraCash(5_000_000)], transactions: [cashLBP(1_234_567)] }).balanceChecks[0].nowNative).toBe(3_765_433);
  });

  it("a dollar balance's figure is its dollars, to the cent", () => {
    expect(dash({ trackedBalances: [bank(1000)], transactions: [spend(12.34)] }).balanceChecks[0].nowNative).toBe(987.66);
  });
});
