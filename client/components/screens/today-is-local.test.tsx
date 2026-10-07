// TIME-02 and TIME-03 (blind-spot audit).
//
// TIME-02: four places took "today" from the UTC calendar
// (`new Date().toISOString().slice(0, 10)`), so for the first two or three
// hours after local midnight east of UTC they used yesterday:
//   * the Transactions trend's "current period" (the new period went missing);
//   * a goal's `achievedAt` (stamped a day early);
//   * a wishlist item's goal target date (a day early);
//   * the export's file name (named for yesterday).
// They now use the LOCAL day. These clocks sit at 01:30 local on the 1st, so
// the tests discriminate only east of UTC: the Asia/Beirut leg is the one
// that would go red; in UTC local and UTC days agree.
//
// TIME-03: "Save toward this" added six months with setMonth, which overflows
// at month-end: from 31 August the target landed on 3 March. It now clamps to
// the target month's last day (debtEngine's addMonths, the recurring engine's
// own rule).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import TransactionsScreen from "./TransactionsScreen";
import WishlistScreen from "./WishlistScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, applyGoalContribution, exportFileName, type LocalFinancials, type StoredGoal, type StoredTransaction, type WishlistItem } from "../../lib/localData";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const at = (d: Date) => vi.useFakeTimers({ now: d, toFake: ["Date"] });
// 1 October 2026, 01:30 local. In Beirut (UTC+3) that's 30 September 22:30 UTC.
const ONE_THIRTY_ON_THE_FIRST = new Date(2026, 9, 1, 1, 30);

describe("TIME-02: today is the local day", () => {
  it("the Transactions trend includes the current period from the first minutes of it", () => {
    at(ONE_THIRTY_ON_THE_FIRST);
    const sep: StoredTransaction = { id: "t1", amount: 46.8, currency: "USD", bucket: "WANTS", category: "dining", description: "Bistro Margaux", date: "2026-09-15", updatedAt: "2026-09-15T12:00:00.000Z" } as StoredTransaction;
    const d = { ...DEFAULT_DATA, income: 3000, transactions: [sep] } as LocalFinancials;
    render(<ThemeProvider><TransactionsScreen financials={d} onChange={vi.fn()} onEdit={vi.fn()} /></ThemeProvider>);
    const trends = screen.getByText("Category trends").closest(".rounded-2xl") as HTMLElement;
    expect(within(trends).getByText("Oct 2026")).toBeTruthy();
  });

  it("a goal completed at 01:30 is achieved today, not yesterday", () => {
    at(ONE_THIRTY_ON_THE_FIRST);
    const goal: StoredGoal = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 1150, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" };
    const r = applyGoalContribution([goal], "g1", 50, 89_500);
    expect(r?.goals[0].achievedAt).toBe("2026-10-01");
  });

  it("the export is named for today", () => {
    at(ONE_THIRTY_ON_THE_FIRST);
    expect(exportFileName()).toBe("essa-data-2026-10-01.json");
  });
});

describe("TIME-02 and TIME-03: a wishlist item's goal is six months out, by the local calendar", () => {
  const LAMP: WishlistItem = { id: "w1", name: "Quartz lamp", emoji: "✨", price: 64.2, currency: "USD", priority: "medium", createdAt: "2026-08-01T09:00:00.000Z", updatedAt: "2026-08-01T09:00:00.000Z" };
  function save(now: Date) {
    at(now);
    const onChange = vi.fn<(d: LocalFinancials) => void>();
    render(<ThemeProvider><WishlistScreen financials={{ ...DEFAULT_DATA, wishlist: [LAMP] } as LocalFinancials} onChange={onChange} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Save toward this" }));
    return onChange.mock.calls[0][0].goals[0].targetDate;
  }

  it("from 31 August the target is 28 February, not 3 March (TIME-03)", () => {
    expect(save(new Date(2026, 7, 31, 12, 0))).toBe("2027-02-28");
  });

  it("at 01:30 on 1 October the target is 1 April, not 31 March (TIME-02)", () => {
    expect(save(ONE_THIRTY_ON_THE_FIRST)).toBe("2027-04-01");
  });

  it("an ordinary day is unchanged", () => {
    expect(save(new Date(2026, 9, 7, 12, 0))).toBe("2027-04-07");
  });
});
