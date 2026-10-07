// CUR-01 (blind-spot audit): My Finances' recurring section added each item's
// monthly amount in ITS OWN currency and showed the sum as dollars. A lira
// item counted at face value: $15 of Netflix plus a L£1,790,000 generator
// subscription read "$1790015/mo total". The Recurring screen already
// converts each term (RecurringScreen.tsx: toUSD(…, r.currency)) and shows $35.
// One question, one answer: the section now converts the same way.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 8, 21)); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

const rec = (o: Partial<StoredRecurring>): StoredRecurring => ({
  id: "r", name: "x", emoji: "🔁", amount: 0, currency: "USD", frequency: "monthly", bucket: "WANTS",
  startDate: "2026-01-15", endDate: null, totalAmount: null, createdAt: "2026-01-15T00:00:00.000Z", ...o,
});
const NETFLIX = rec({ id: "r-netflix", name: "Netflix", amount: 15, currency: "USD" });
const GENERATOR = rec({ id: "r-gen", name: "Generator subscription", amount: 1_790_000, currency: "LBP", bucket: "NEEDS" });

async function totalShown(recurring: StoredRecurring[]) {
  const data = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, recurring } as LocalFinancials;
  render(<InputPanel financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(screen.getByRole("button", { name: /Manage/ }));
  await user.click(screen.getByRole("button", { name: /Recurring Payments/ }));
  return screen.getByText("/mo total").parentElement!.textContent;
}

describe("the recurring section's monthly total", () => {
  it("converts a lira item before adding it: $15 + L£1,790,000 at 89,500 is $35", async () => {
    expect(await totalShown([NETFLIX, GENERATOR])).toBe("$35/mo total");
  });

  it("an all-lira account's total is in dollars, not the lira figure with a $ in front", async () => {
    expect(await totalShown([GENERATOR])).toBe("$20/mo total");
  });

  it("unchanged for dollars only", async () => {
    expect(await totalShown([NETFLIX])).toBe("$15/mo total");
  });
});
