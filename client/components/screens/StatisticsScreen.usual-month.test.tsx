// Session 60: the "Your usual month" card on Statistics, after "This month vs. last month". Every sentence as the
// owner approved it in session 61 (FIX_PLANS session 60, Part 2), checked verbatim here.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import StatisticsScreen from "./StatisticsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../../lib/localData";

let n = 0;
const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: `t${n++}`, amount: 10, currency: "USD", bucket: "NEEDS", description: "x", date: "2026-10-03", paymentMethod: "cash", createdAt: "2026-10-03T10:00:00.000Z", ...o }) as StoredTransaction;

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-20T12:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const show = (rows: StoredTransaction[]) => {
  const d = { ...DEFAULT_DATA, income: 3000, transactions: rows } as LocalFinancials;
  render(<ThemeProvider><StatisticsScreen financials={d} dashData={computeDashboard(d)} /></ThemeProvider>);
};
const card = () => screen.getByRole("heading", { level: 2, name: /^Your usual/ }).closest("section")!;

describe("Statistics: Your usual month", () => {
  it("its heading, the lead line, the line for a category well above, and the two column names", () => {
    show([
      ...["08", "09", "10"].map((m) => tx({ category: "groceries", amount: 200, date: `2026-${m}-05` })),
      tx({ category: "groceries", amount: 260, date: "2026-11-04" }),
    ]);
    const c = card();
    expect(c.querySelector("h2")!.textContent).toBe("Your usual month");
    expect(c.textContent).toContain("This month so far, against the average of your last three months.");
    expect(c.textContent).toContain("Groceries is already 30% above your usual month ($60 more).");
    expect(c.textContent).toContain("So far");
    expect(c.textContent).toContain("Usual");
  });

  it("with nothing above: \"Nothing is above your usual month so far.\"", () => {
    show([
      ...["08", "09", "10"].map((m) => tx({ category: "groceries", amount: 200, date: `2026-${m}-05` })),
      tx({ category: "groceries", amount: 100, date: "2026-11-04" }),
    ]);
    expect(card().textContent).toContain("Nothing is above your usual month so far.");
  });

  it("Uncategorized never gets a line; its row stays (owner, session 61)", () => {
    show([
      ...["08", "09", "10"].map((m) => tx({ amount: 200, date: `2026-${m}-05` })),
      tx({ amount: 400, date: "2026-11-04" }),
    ]);
    const c = card();
    expect(c.textContent).not.toContain("Uncategorized is already");
    expect(c.textContent).toContain("Nothing is above your usual month so far.");
    expect(within(c).getByRole("rowheader", { name: "Uncategorized" })).toBeTruthy();
  });

  it("an empty category and no category: one Uncategorized row (owner, session 62)", () => {
    show(["08", "09", "10", "11"].flatMap((m) => [tx({ amount: 100, date: `2026-${m}-04` }), tx({ category: "", amount: 50, date: `2026-${m}-05` })]));
    expect(within(card()).getAllByRole("rowheader", { name: "Uncategorized" })).toHaveLength(1);
  });

  it("too little history: the empty state, and no figures", () => {
    show([tx({ category: "groceries", amount: 200, date: "2026-10-05" })]);
    const c = card();
    expect(c.textContent).toContain("Your usual month shows once each of your last three months has entries.");
    expect(c.textContent).not.toContain("So far");
  });
});
