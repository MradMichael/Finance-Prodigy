// Session 68's plan, step D (owner approved, session 69, D1 (a), D2 (a)): the monthly report's Money in groups
// Income entries by category ("Extra income" for none), not by their exact descriptions, and its total keeps its
// meaning: the salary plus Income entries, the same figure Statistics calls Income (periodTotals). A new section,
// "Paid back and borrowed", lists the Transfers that gained by category ("Paid back: {category}", "Paid back") and
// each loan received ("Borrowed: {debt}"), outside Money in, with no total and no comparison. A transfer's two legs, a
// foreign-cash change-back, a Transfer that lost and a deleted row appear in it nowhere.
import { describe, it, expect } from "vitest";
import { buildMonthlyReport, REPORT_TEXT } from "./monthlyReport";
import { reportImageLines } from "./reportImage";
import { periodTotals } from "./computeDashboard";
import { DEFAULT_DATA, roundMoney, type LocalFinancials, type StoredDebt, type StoredTransaction } from "./localData";
import type { CycleKey } from "./period";

let n = 0;
const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: `m${n++}`, amount: 10, currency: "USD", bucket: "INCOME", description: "x", date: "2026-07-03", paymentMethod: "cash", createdAt: "2026-07-03T10:00:00.000Z", ...o }) as StoredTransaction;
const K = (k: string) => k as CycleKey;
const NOW = new Date("2026-07-25T12:00:00");
const DAD: StoredDebt = { id: "d1", name: "Loan from Dad", balance: 200, openingBalance: 200, apr: 0, minPayment: 0, currency: "USD", createdAt: "2026-07-01T00:00:00.000Z" };

function account(extra: StoredTransaction[] = []): LocalFinancials {
  const july = [
    tx({ description: "DAD for Fuel", amount: 25, category: "transport" }),
    tx({ description: "DAD fuel", amount: 30, category: "transport", date: "2026-07-09" }),
    tx({ description: "Bonus", amount: 200 }),
    tx({ description: "Freelance gig", amount: 100, category: "other" }),
    tx({ description: "Tips", amount: 895_000, currency: "LBP", date: "2026-07-12" }), // $10 at 89,500
    tx({ bucket: "WANTS", description: "Dinner", amount: 60, category: "dining" }),
    // Paid back and borrowed:
    tx({ bucket: "TRANSFER", description: "Insurance payout", amount: 120, category: "insurance" }),
    tx({ bucket: "TRANSFER", description: "Mom paid back haircut", amount: 18 }),
    tx({ bucket: "TRANSFER", description: "Borrowed: Loan from Dad", amount: 200, borrowedForDebtId: "d1" }),
    tx({ bucket: "TRANSFER", description: "Borrowed: Old loan", amount: 75, borrowedForDebtId: "d-gone" }), // its debt deleted
    // Nowhere in the new section:
    tx({ bucket: "TRANSFER", description: "Transfer from Visa", amount: 50, linkedPaymentId: "k1" }),
    tx({ bucket: "TRANSFER", description: "Transfer to Cash", amount: -50, linkedPaymentId: "k1", paymentMethod: "card" }),
    tx({ bucket: "TRANSFER", description: "Euros changed back", amount: 30, category: "travel", fx: { kind: "back", amount: 28, code: "EUR" } } as Partial<StoredTransaction>),
    tx({ bucket: "TRANSFER", description: "Cash to savings account", amount: -60 }),
    tx({ bucket: "TRANSFER", description: "Deleted payback", amount: 999, category: "insurance", deletedAt: "2026-07-20T00:00:00.000Z" }),
    tx({ bucket: "INCOME", description: "Deleted income", amount: 999, deletedAt: "2026-07-20T00:00:00.000Z" }),
  ];
  const june = [
    tx({ description: "Bonus", amount: 40, date: "2026-06-10" }),
    tx({ bucket: "TRANSFER", description: "June payback", amount: 15, category: "insurance", date: "2026-06-12" }),
  ];
  return { ...DEFAULT_DATA, income: 1500, lbpRate: 89_500, debts: [DAD], transactions: [...july, ...june, ...extra] } as LocalFinancials;
}

describe("Money in", () => {
  const data = account();
  const r = buildMonthlyReport(data, K("2026-07"), NOW);

  it("the salary as Income, then Income entries by category, \"Extra income\" for none; largest first", () => {
    expect(r.moneyIn.lines).toEqual([
      { label: "Income", usd: 1500 },
      { label: "Extra income", usd: 210 },
      { label: "Other", usd: 100 },
      { label: "Transport", usd: 55 },
    ]);
  });

  it("one figure, two screens: Money in's total is Statistics' Income for the same period", () => {
    expect(r.moneyIn.total).toBe(1865);
    expect(r.moneyIn.total).toBe(roundMoney(periodTotals(data, K("2026-07"), NOW).income));
  });

  it("paybacks and loans received don't count in Money in", () => {
    const without = account().transactions.filter((t) => t.bucket !== "TRANSFER");
    expect(buildMonthlyReport({ ...data, transactions: without }, K("2026-07"), NOW).moneyIn.total).toBe(r.moneyIn.total);
  });
});

describe("Paid back and borrowed", () => {
  const r = buildMonthlyReport(account(), K("2026-07"), NOW);

  it("paybacks by category, each loan received by its debt (a deleted debt: the entry's own words); largest first", () => {
    expect(r.paidBackAndBorrowed.lines).toEqual([
      { label: "Borrowed: Loan from Dad", usd: 200 },
      { label: "Paid back: Insurance", usd: 120 },
      { label: "Borrowed: Old loan", usd: 75 },
      { label: "Paid back", usd: 18 },
    ]);
  });

  it("the approved words", () => {
    expect(REPORT_TEXT.paidBackAndBorrowed).toBe("Paid back and borrowed");
    expect(REPORT_TEXT.notCounted).toBe("Not counted in Money in.");
  });

  it("isn't compared with the period before", () => {
    const big = account([tx({ bucket: "TRANSFER", description: "Big payback", amount: 900, category: "insurance", date: "2026-07-21" })]);
    const names = buildMonthlyReport(big, K("2026-07"), NOW).changes.map((c) => c.name);
    expect(names.some((x) => /Paid back|Borrowed/.test(x))).toBe(false);
  });

  it("a period with none has no lines", () => {
    expect(buildMonthlyReport(account(), K("2026-05"), NOW).paidBackAndBorrowed.lines).toEqual([]);
  });
});

describe("the shared image", () => {
  it("carries the section after Money in, with the note, and the same lines as the screen", () => {
    const r = buildMonthlyReport(account(), K("2026-07"), NOW);
    const lines = reportImageLines(r);
    const at = lines.findIndex((l) => l.text === "Paid back and borrowed");
    expect(lines[at]).toMatchObject({ kind: "heading" });
    expect(lines[at].right).toBeUndefined();
    expect(lines[at - 1]).toMatchObject({ text: "Transport", kind: "line" }); // Money in's last line
    expect(lines[at + 1]).toMatchObject({ text: "Not counted in Money in.", kind: "note" });
    expect(lines.slice(at + 2, at + 6).map((l) => [l.text, l.right])).toEqual([
      ["Borrowed: Loan from Dad", "$200.00"], ["Paid back: Insurance", "$120.00"], ["Borrowed: Old loan", "$75.00"], ["Paid back", "$18.00"],
    ]);
    expect(lines[at + 6]).toMatchObject({ text: "Bills and debt payments", kind: "heading" });
  });

  it("leaves the section out when it has no lines", () => {
    const r = buildMonthlyReport({ ...account(), transactions: account().transactions.filter((t) => t.bucket !== "TRANSFER") }, K("2026-07"), NOW);
    expect(reportImageLines(r).some((l) => l.text === "Paid back and borrowed")).toBe(false);
  });
});
