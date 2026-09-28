// ZERO-DIFF GATE for extracting logExtraPayment's transaction builder.
//
// Written and run GREEN against the INLINE code before the extraction, then
// run unchanged after it. It pins the whole written transaction — every key,
// every value, and KEY ORDER (via JSON.stringify), since a refactor that
// reorders a spread is not zero-diff even when toEqual passes.
//
// Normalised: the id (uid() is random by design) and the two timestamp
// VALUES (they drift by ms under shouldAdvanceTime) — checked, then replaced
// in place so key order is still part of the comparison.
//
// Two fixtures, because the builder has two conditional spreads and each
// must be exercised both ways (2.4.116):
//   LBP + category  -> `category` present, `lbpRateAtEntry` present
//   USD, no category -> both absent
// Real figures (2.4.139): 1,342,500 lira at 89,500 is $15.00 — a stray
// conversion would land four orders of magnitude from the stored amount.
//
// NOT REACHED: paymentMethod other than "cash" — the inline code hard-codes
// it, and so must the builder; there is no second value to exercise.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring } from "../lib/localData";

const NOW = new Date(2026, 8, 21, 14, 32, 7);
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

const REC_LBP: StoredRecurring = {
  id: "r-lbp", name: "Generator", emoji: "G", amount: 2_685_000, currency: "LBP",
  frequency: "monthly", bucket: "NEEDS", category: "utilities",
  startDate: "2026-01-15", endDate: null, totalAmount: null, lbpRateAtEntry: 89_500,
  createdAt: "2026-01-15T00:00:00.000Z",
};
const REC_USD: StoredRecurring = {
  id: "r-usd", name: "Uni", emoji: "U", amount: 750, currency: "USD",
  frequency: "monthly", bucket: "WANTS",
  startDate: "2026-01-15", endDate: null, totalAmount: null,
  createdAt: "2026-01-15T00:00:00.000Z",
};

async function logExtra(rec: StoredRecurring, amount: string) {
  const data = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, recurring: [rec], transactions: [] } as LocalFinancials;
  let latest = data;
  const onChange = vi.fn((u: LocalFinancials) => { latest = u; });
  render(<InputPanel financials={data} dashData={computeDashboard(data)} onChange={onChange} onEdit={vi.fn()} onPay={vi.fn()} />);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(screen.getByRole("button", { name: /Manage/ }));
  await user.click(screen.getByRole("button", { name: /Recurring Payments/ }));
  await user.click(screen.getByRole("button", { name: "Log an extra payment" }));
  fireEvent.change(screen.getByPlaceholderText("Extra amount"), { target: { value: amount } });
  await user.click(screen.getByRole("button", { name: "Log" }));
  expect(onChange).toHaveBeenCalledTimes(1);
  const { id, ...rest } = latest.transactions[0];
  expect(typeof id).toBe("string");
  // Timestamps drift by milliseconds under shouldAdvanceTime, so their
  // VALUES are checked here and replaced; their KEYS and positions stay in
  // the pinned string, so key order is still compared.
  expect(rest.createdAt).toBe(rest.updatedAt);
  expect(Math.abs(new Date(rest.createdAt!).getTime() - NOW.getTime())).toBeLessThan(1000);
  return JSON.stringify({ ...rest, createdAt: "T", updatedAt: "T" });
}

describe("logExtraPayment writes byte-identical transactions across the extraction", () => {
  it("LBP with a category", async () => {
    expect(await logExtra(REC_LBP, "1,342,500")).toBe(
      '{"amount":1342500,"currency":"LBP","bucket":"NEEDS","category":"utilities","lbpRateAtEntry":89500,' +
      '"description":"Extra: Generator","date":"2026-09-21","paymentMethod":"cash","extraForRecurringId":"r-lbp",' +
      '"createdAt":"T","updatedAt":"T"}',
    );
  });

  it("USD without a category", async () => {
    expect(await logExtra(REC_USD, "212.40")).toBe(
      '{"amount":212.4,"currency":"USD","bucket":"WANTS",' +
      '"description":"Extra: Uni","date":"2026-09-21","paymentMethod":"cash","extraForRecurringId":"r-usd",' +
      '"createdAt":"T","updatedAt":"T"}',
    );
  });
});
