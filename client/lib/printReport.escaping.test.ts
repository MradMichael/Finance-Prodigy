// SEC-02 and TEST-01 (2026-10-05). The print report is a same-origin HTML page
// built by string interpolation. Two stored fields went in raw -- a
// transaction's date and a debt's APR -- and an imported file can make either
// a string of markup. Nothing tested the escaping at all: replacing escapeHtml
// with `return s` failed no test.
//
// So: every user-controlled field carries `<`, `&` and both quotes, the two
// SEC-02 vectors go through the real import -> dashboard -> report pipeline,
// and a non-text value where text belongs must not crash the report.
import { describe, it, expect } from "vitest";
import { buildReportHtml } from "./printReport";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, migrateFinancials, type LocalFinancials } from "./localData";

const PAYLOAD = `<img src=x onerror=probe()>`;
// A per-field marker with every character escaping must handle.
const m = (field: string) => `<i>${field}</i>&"'`;

function report(data: LocalFinancials, detailed = true, userName = "Quartz Runner") {
  const migrated = migrateFinancials(data);
  return buildReportHtml(userName, migrated, computeDashboard(migrated), { detailed });
}

const BASE: LocalFinancials = {
  ...DEFAULT_DATA,
  income: 2400,
  transactions: [{
    id: "t1", amount: 12.5, currency: "USD", bucket: "NEEDS", category: "groceries",
    description: "Supermarket", date: "2026-09-01", createdAt: "2026-09-01T12:00:00.000Z",
  }],
  debts: [{ id: "d1", name: "Card", balance: 1200, openingBalance: 1200, apr: 24, minPayment: 60, currency: "USD", createdAt: "2026-07-01T00:00:00.000Z" }],
} as LocalFinancials;

describe("the print report escapes what it can't trust (SEC-02, TEST-01)", () => {
  it("a transaction date carrying markup comes out as text (SEC-02, detailed report)", () => {
    const html = report({ ...BASE, transactions: [{ ...BASE.transactions[0], date: `2026-09-01${PAYLOAD}` }] } as LocalFinancials);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("a debt APR carrying markup comes out as text, in the ordinary summary report (SEC-02)", () => {
    const html = report({ ...BASE, debts: [{ ...BASE.debts[0], apr: `18${PAYLOAD}` as unknown as number }] } as LocalFinancials, false);
    expect(html).not.toContain("<img");
  });

  it("an ordinary date and APR still read the same as before", () => {
    const html = report(BASE);
    expect(html).toContain("<td>01/09/2026</td>");
    expect(html).toContain(`<td class="num">24%</td>`);
  });

  it("every user-controlled field carrying <, & and both quotes is escaped, nowhere raw", () => {
    const crafted = {
      ...BASE,
      userName: m("userName"),
      customCategories: [{ value: "c-mine", label: m("customCategory"), icon: m("categoryIcon") }],
      transactions: [{ ...BASE.transactions[0], description: m("description"), category: "c-mine" }],
      goals: [{ id: "g1", name: m("goalName"), emoji: m("goalEmoji"), targetAmount: 1500, currentAmount: 300, currency: "USD", targetDate: "2027-06-01", createdAt: "2026-07-01T00:00:00.000Z" }],
      debts: [{ ...BASE.debts[0], name: m("debtName") }],
      recurring: [{ id: "r1", name: m("recurringName"), emoji: m("recurringEmoji"), amount: 20, currency: "USD", frequency: "monthly", bucket: "NEEDS", category: "c-mine", startDate: "2026-07-05", endDate: null, totalAmount: null, createdAt: "2026-07-01T00:00:00.000Z" }],
    } as LocalFinancials;
    const html = report(crafted, true, m("userName"));
    // Premise: each field really reached the page -- escaped -- so "no raw <i>" can't pass by omission.
    for (const f of ["userName", "customCategory", "description", "goalName", "goalEmoji", "debtName", "recurringName", "recurringEmoji"]) {
      expect(html, f).toContain(`&lt;i&gt;${f}&lt;/i&gt;&amp;&quot;&#39;`);
    }
    expect(html).not.toMatch(/<i>/);
  });

  it("a non-text value where text belongs doesn't crash the report", () => {
    const html = report({ ...BASE, transactions: [{ ...BASE.transactions[0], description: 12345 as unknown as string }] } as LocalFinancials);
    expect(html).toContain("<td>12345</td>");
  });

  it("an unknown bucket or frequency from an imported file shows as escaped text, not \"undefined\"", () => {
    const html = report({
      ...BASE,
      transactions: [{ ...BASE.transactions[0], bucket: `<b>odd</b>` as unknown as "NEEDS" }],
      recurring: [{ id: "r1", name: "Phone", emoji: "📱", amount: 20, currency: "USD", frequency: `<b>often</b>` as unknown as "monthly", bucket: "NEEDS", startDate: "2026-07-05", endDate: null, totalAmount: null, createdAt: "2026-07-01T00:00:00.000Z" }],
    } as LocalFinancials);
    expect(html).not.toMatch(/<b>/);
    expect(html).not.toContain(">undefined<");
  });
});
