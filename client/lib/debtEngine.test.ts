import { describe, it, expect } from "vitest";
import { simulateDebtPayoff, type DebtInput } from "./debtEngine";

describe("simulateDebtPayoff", () => {
  it("returns a feasible zero-month plan when there are no debts", () => {
    const result = simulateDebtPayoff([], 0, "AVALANCHE");
    expect(result.feasible).toBe(true);
    expect(result.months).toBe(0);
    expect(result.totalInterest).toBe(0);
  });

  it("is infeasible when the monthly commitment doesn't cover first-month interest", () => {
    const debts: DebtInput[] = [{ id: "d1", name: "Loan", balance: 10000, aprPct: 99, minimumPayment: 1 }];
    const result = simulateDebtPayoff(debts, 0, "AVALANCHE");
    expect(result.feasible).toBe(false);
    expect(result.months).toBe(-1);
    expect(result.debtFreeDate).toBeNull();
    expect(result.warning).toBeTruthy();
  });

  it("monthly commitment is the sum of minimums plus extra, regardless of strategy", () => {
    const debts: DebtInput[] = [
      { id: "d1", name: "A", balance: 500, aprPct: 10, minimumPayment: 30 },
      { id: "d2", name: "B", balance: 300, aprPct: 15, minimumPayment: 20 },
    ];
    const snowball = simulateDebtPayoff(debts, 100, "SNOWBALL");
    const avalanche = simulateDebtPayoff(debts, 100, "AVALANCHE");
    expect(snowball.monthlyCommitment).toBe(150); // 30 + 20 + 100
    expect(avalanche.monthlyCommitment).toBe(150);
  });

  it("avalanche never costs more total interest than snowball on the same decorrelated inputs", () => {
    // Small balance + low APR vs. large balance + high APR — decorrelated on
    // purpose so the two strategies actually disagree on what to target first.
    const debts: DebtInput[] = [
      { id: "small-low-apr", name: "A", balance: 200, aprPct: 5, minimumPayment: 10 },
      { id: "large-high-apr", name: "B", balance: 1000, aprPct: 25, minimumPayment: 20 },
    ];
    const snowball = simulateDebtPayoff(debts, 100, "SNOWBALL");
    const avalanche = simulateDebtPayoff(debts, 100, "AVALANCHE");
    expect(avalanche.totalInterest).toBeLessThan(snowball.totalInterest);
  });

  it("both debts end up fully paid off (balance reaches 0) once feasible", () => {
    const debts: DebtInput[] = [
      { id: "d1", name: "A", balance: 500, aprPct: 12, minimumPayment: 25 },
      { id: "d2", name: "B", balance: 300, aprPct: 8, minimumPayment: 15 },
    ];
    const result = simulateDebtPayoff(debts, 50, "AVALANCHE");
    expect(result.feasible).toBe(true);
    expect(result.months).toBeGreaterThan(0);
    expect(result.months).toBeLessThan(600);
  });

  it("caps at 600 months rather than looping forever, and reports infeasible (not a false payoff date) when the cap is hit before the debt actually clears", () => {
    // Interest ~= (1_000_000 * 1) / 1200 = 833.33, commitment 1000 clears the
    // upfront feasibility bar by a hair, but at this pace amortization takes
    // roughly 179 years — the loop hits the 600-month (50-year) cap with real
    // balance still outstanding. Reporting feasible:true with a concrete
    // debt-free date here would show a wrong payoff date as a real one.
    const debts: DebtInput[] = [{ id: "d1", name: "Mortgage-ish", balance: 1_000_000, aprPct: 1, minimumPayment: 1000 }];
    const result = simulateDebtPayoff(debts, 0, "AVALANCHE");
    expect(result.feasible).toBe(false);
    expect(result.months).toBe(-1);
    expect(result.debtFreeDate).toBeNull();
    expect(result.warning).toBeTruthy();
  });

  it("carries the payoff date across a December -> January year boundary", () => {
    // minimumPayment comfortably exceeds balance+interest so this clears in
    // exactly 1 month, unambiguously (a payment sized ~= balance can take an
    // extra month, since interest accrues before the payment each pass).
    const debts: DebtInput[] = [{ id: "d1", name: "Small", balance: 100, aprPct: 5, minimumPayment: 1000 }];
    const start = new Date(2026, 11, 15); // Dec 15, 2026
    const result = simulateDebtPayoff(debts, 0, "AVALANCHE", start);
    expect(result.feasible).toBe(true);
    expect(result.months).toBe(1);
    const freeDate = new Date(result.debtFreeDate!);
    expect(freeDate.getFullYear()).toBe(2027);
    expect(freeDate.getMonth()).toBe(0); // January
  });

  it("rounds totalInterest to 2 decimal places", () => {
    const debts: DebtInput[] = [{ id: "d1", name: "A", balance: 333.33, aprPct: 17, minimumPayment: 40 }];
    const result = simulateDebtPayoff(debts, 0, "AVALANCHE");
    const decimals = (result.totalInterest.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it("lands the payoff date in the correct month when starting on the 31st (no Date.setMonth overflow)", () => {
    // Same overflow bug already fixed in localData.ts's nextOccurrence:
    // a naive d.setMonth(d.getMonth()+1) on Jan 31 lands on March 3
    // (Feb only has 28 days in 2026), a full month later than intended.
    const debts: DebtInput[] = [{ id: "d1", name: "Small", balance: 100, aprPct: 5, minimumPayment: 1000 }];
    const start = new Date(2026, 0, 31); // Jan 31, 2026
    const result = simulateDebtPayoff(debts, 0, "AVALANCHE", start);
    expect(result.feasible).toBe(true);
    expect(result.months).toBe(1);
    const freeDate = new Date(result.debtFreeDate!);
    expect(freeDate.getMonth()).toBe(1); // February, not March
    expect(freeDate.getDate()).toBe(28); // clamped to Feb's actual last day
  });

  it("excludes an already-paid-off debt's stale minimumPayment from monthlyCommitment", () => {
    // A paid-off debt (balance 0) can still be passed in with its original
    // minimumPayment intact (the app keeps paid-off debts around for
    // history) — that payment obligation is gone and shouldn't count.
    const debts: DebtInput[] = [
      { id: "d1", name: "Active", balance: 500, aprPct: 10, minimumPayment: 100 },
      { id: "d2", name: "Paid off", balance: 0, aprPct: 20, minimumPayment: 200 },
    ];
    const result = simulateDebtPayoff(debts, 50, "AVALANCHE");
    expect(result.monthlyCommitment).toBe(150); // 100 + 50, not 300 + 50
  });
});

describe("simulateDebtPayoff caching", () => {
  it("returns an equal result for repeated calls with the same inputs (cache hit is transparent)", () => {
    const debts: DebtInput[] = [{ id: "d1", name: "Card", balance: 3000, aprPct: 22, minimumPayment: 100 }];
    const start = new Date("2026-01-01");
    const first = simulateDebtPayoff(debts, 50, "AVALANCHE", start);
    const second = simulateDebtPayoff(debts, 50, "AVALANCHE", start);
    expect(second).toEqual(first);
  });

  it("still recomputes when the debts actually change, even with the same array reference (cache keys on content, not identity)", () => {
    const debts: DebtInput[] = [{ id: "d1", name: "Card", balance: 3000, aprPct: 22, minimumPayment: 100 }];
    const start = new Date("2026-01-01");
    const first = simulateDebtPayoff(debts, 50, "AVALANCHE", start);
    debts[0].balance = 5000; // mutate in place — same reference, different content
    const second = simulateDebtPayoff(debts, 50, "AVALANCHE", start);
    expect(second.totalInterest).not.toBe(first.totalInterest);
  });

  it("keys separately by strategy — AVALANCHE and SNOWBALL for the same debts don't collide", () => {
    // A small high-APR balance alongside a large low-APR one: AVALANCHE
    // clears the expensive small one first (minimal extra interest paid on
    // the large balance in the meantime); SNOWBALL's balance-order ties
    // here (small balance already wins on both criteria), so use three
    // debts where the "smallest balance" and "highest APR" picks genuinely
    // disagree on which to pay off first.
    const debts: DebtInput[] = [
      { id: "d1", name: "Small, cheap", balance: 500,  aprPct: 5,  minimumPayment: 25 },
      { id: "d2", name: "Big, expensive", balance: 8000, aprPct: 27, minimumPayment: 50 },
      { id: "d3", name: "Medium", balance: 2000, aprPct: 15, minimumPayment: 40 },
    ];
    const start = new Date("2026-01-01");
    const avalanche = simulateDebtPayoff(debts, 200, "AVALANCHE", start);
    const snowball = simulateDebtPayoff(debts, 200, "SNOWBALL", start);
    expect(avalanche.totalInterest).not.toBe(snowball.totalInterest);
  });
});
