// COPY-10 (its lira half): My Finances → Recurring Payments showed a lira
// item's monthly figure with no thousands separators ("L£1790000/mo"),
// directly under its own "L£1,790,000 · Monthly". The figure now groups its
// digits like every other amount; the dollar figure and the list's total do
// too ("$1,200/mo", "$1,220/mo total").
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring } from "../lib/localData";

afterEach(cleanup);

const rec = (id: string, name: string, amount: number, currency: "USD" | "LBP"): StoredRecurring =>
  ({ id, name, emoji: "🔁", amount, currency, frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z" }) as StoredRecurring;

it("a lira and a dollar item's monthly figures carry thousands separators", async () => {
  const data = { ...DEFAULT_DATA, income: 3000, recurring: [rec("r1", "Generator", 1_790_000, "LBP"), rec("r2", "Rent", 1200, "USD")] } as LocalFinancials;
  render(<InputPanel financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Manage/ }));
  await user.click(screen.getByRole("button", { name: /Recurring Payments/ }));
  const text = document.body.textContent ?? "";
  expect(text).toContain("L£1,790,000/mo");
  expect(text).not.toContain("L£1790000/mo");
  expect(text).toContain("$1,200/mo");
  expect(text).toMatch(/\$1,2\d\d\/mo total/); // the list's total, in dollars, grouped too
});
