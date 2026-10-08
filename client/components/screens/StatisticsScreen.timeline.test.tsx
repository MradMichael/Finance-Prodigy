// TIME-06, third site (found in session 3): Statistics' planned-payments
// timeline walks each recurring item's occurrences by adding 24 hours to a
// UTC-midnight due date, the same step dueCycles and nextConfirmTarget used.
// West of UTC that is still the same local day, so nextOccurrence returned the
// same date again: each item due in the next 30 days was listed up to 6 times,
// and the total multiplied with it. It discriminates in the Los Angeles leg.
import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StatisticsScreen from "./StatisticsScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0)); }); // 15 Aug 2026, local noon
afterEach(() => { vi.useRealTimers(); });

const item = (o: Partial<StoredRecurring>): StoredRecurring => ({
  id: "r", name: "x", emoji: "•", amount: 1, currency: "USD", frequency: "monthly", bucket: "NEEDS",
  startDate: "2026-07-01", endDate: null, totalAmount: null, createdAt: "2026-07-01T00:00:00.000Z", ...o,
});

it("lists each occurrence in the next 30 days once, and totals them once", () => {
  const data = {
    ...DEFAULT_DATA, income: 3000,
    recurring: [
      item({ id: "r-rent", name: "Rent", amount: 900, frequency: "monthly", startDate: "2026-07-01" }), // 1 Sep
      item({ id: "r-gym", name: "Gym", amount: 20, frequency: "weekly", startDate: "2026-08-03" }), // 17, 24, 31 Aug, 7, 14 Sep
    ],
  } as LocalFinancials;
  render(<StatisticsScreen financials={data} dashData={computeDashboard(data)} />);
  const card = screen.getByText("Planned payments, next 30 days").closest("div.rounded-2xl")!;
  const rows = Array.from(card.querySelectorAll("div.space-y-2 > div")).map((r) => r.textContent ?? "");
  expect(rows.filter((t) => t.includes("Rent"))).toHaveLength(1);
  expect(rows.filter((t) => t.includes("Gym"))).toHaveLength(5);
  expect(card.textContent).toMatch(/\$1,000(\.00)? total/);
});
