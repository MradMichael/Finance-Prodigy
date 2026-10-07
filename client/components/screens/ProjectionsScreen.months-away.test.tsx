// COPY-01 (blind-spot audit): Projections dated every stage from TODAY, but
// counted its "months away" from when that stage STARTS, after the stages
// before it. So the debt stage's "In your plan" read "13-09-2027 · 4 months
// away" when that date is 12 months away, and each goal's "(N mo)" left out
// the safety-net and debt stages ahead of it. The count now runs from today,
// like its date. A stage that's already done still reads "Already there".
//
// Fixture: the anchor test's (ProjectionsScreen.anchor.test.tsx), clock at
// 13 September 2026. The safety net takes 8 months, debt 4 more, the goal 9
// more after that.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ProjectionsScreen from "./ProjectionsScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 13)); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

function show(over: Partial<LocalFinancials> = {}) {
  const data = {
    ...DEFAULT_DATA, income: 3000, budgetRule: "50-30-20", emergencyFundBalance: 1000, emergencyFundTargetMonths: 3,
    debts: [{ id: "d1", name: "Card", openingBalance: 2000, apr: 18, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }],
    goals: [{ id: "g1", name: "Trip", emoji: "✈️", targetAmount: 4000, currentAmount: 0, currency: "USD", targetDate: "2028-06-01", createdAt: "2026-01-01T00:00:00.000Z" }],
    ...over,
  } as LocalFinancials;
  render(<ProjectionsScreen financials={data} dashData={computeDashboard(data)} />);
}
const inYourPlan = (i: number) => Array.from(screen.getAllByText("In your plan")[i].parentElement!.querySelectorAll("p")).map((p) => p.textContent);

describe("months away count from today, like the dates beside them", () => {
  it("the debt stage: 13-09-2027 is 12 months away (8 for the safety net, then 4)", () => {
    show();
    expect(inYourPlan(1)).toEqual(["In your plan", "13-09-2027", "12 months away"]);
  });

  it("the first stage is unchanged: the safety net, 8 months", () => {
    show();
    expect(inYourPlan(0)).toEqual(["In your plan", "13-05-2027", "8 months away"]);
  });

  it("a goal's plan row: 13-06-2028 is 21 months away (12 before the goals stage, then 9)", () => {
    show();
    expect(document.body.textContent).toContain("13-06-2028 (21 mo)");
    expect(document.body.textContent).not.toContain("(9 mo)");
  });

  it("the fastest view counts from today too", () => {
    show();
    const toggle = screen.getAllByRole("button").find((b) => b.getAttribute("aria-pressed") !== null)!;
    fireEvent.click(toggle);
    const fastest = screen.getByText(/^Fastest/).parentElement!.textContent!;
    const [, date, mo] = fastest.match(/(\d{2}-\d{2}-\d{4}) \((\d+) mo\)/)!;
    // The date and the count agree: months from 13 Sep 2026 to the date shown.
    const [d, m, y] = date.split("-").map(Number);
    expect(Number(mo)).toBe((y - 2026) * 12 + (m - 9) + (d >= 13 ? 0 : -1));
  });

  it("a stage already done still says so", () => {
    show({ debts: [] });
    expect(screen.getByText("Debt-free already. 🏁")).toBeTruthy();
  });
});
