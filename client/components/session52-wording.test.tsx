// Session 52 (owner): three sentences from the session 51 review, approved as drafted.
//   R9  Close cycle stayed greyed out with no reason given. Under the disabled button now:
//       "To close, enter what you actually have for each balance, and a note for any gap you've ticked."
//   R11 two placeholders were cut off on a phone: "Search entries" (Transactions) and "What you have now"
//       (Balance Check).
//   R15 the sync dot said "Resolve in Settings."; no screen is called Settings. It says "Resolve in Profile."
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import CloseCycleModal, { type CloseRow } from "./CloseCycleModal";
import TransactionsScreen from "./screens/TransactionsScreen";
import { syncStatusLongLabel } from "./shell/SyncDot";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type TrackedBalance } from "../lib/localData";

afterEach(cleanup);

const HINT = "To close, enter what you actually have for each balance, and a note for any gap you've ticked.";
const CASH: TrackedBalance = { id: "tb-cash", name: "Cash", paymentMethod: "cash", startingBalance: 200, startingDate: "2026-09-01", startingAt: "2026-09-01T09:00:00.000Z", currency: "USD" };
const ROW: CloseRow = { tb: CASH, expectedAtClose: 200 };

function closeDialog(rows: CloseRow[]) {
  render(<ThemeProvider><CloseCycleModal cycleLabel="September 2026" rows={rows} adjustmentRows={[]} daysLate={0} rangeEnd="30/09/2026" reopenable lbpRateAtClose={89500} onCancel={vi.fn()} onConfirm={vi.fn()} /></ThemeProvider>);
  return screen.getByRole("button", { name: "Close cycle" }) as HTMLButtonElement;
}

describe("R9: why Close cycle is greyed out", () => {
  it("with a balance still to enter: the button is disabled and the line says what's missing", () => {
    const button = closeDialog([ROW]);
    expect(button.disabled).toBe(true);
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it("once the amount is entered: the button is enabled and the line is gone", () => {
    const button = closeDialog([ROW]);
    fireEvent.change(document.getElementById("close-amt-tb-cash")!, { target: { value: "200" } });
    expect(button.disabled).toBe(false);
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("with nothing to close at all, the line isn't shown: there is no balance to enter", () => {
    const button = closeDialog([]);
    expect(button.disabled).toBe(true);
    expect(screen.queryByText(HINT)).toBeNull();
  });
});

describe("R11: placeholders that fit a phone", () => {
  it("Transactions: Search entries", () => {
    const data = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
    render(<ThemeProvider><TransactionsScreen financials={data} onChange={vi.fn()} onEdit={vi.fn()} /></ThemeProvider>);
    expect(screen.getByPlaceholderText("Search entries")).toBeTruthy();
  });
});

describe("R15: the sync dot's conflict line", () => {
  it("points at Profile", () => {
    expect(syncStatusLongLabel("conflict")).toBe("Sync conflict — server has newer data. Resolve in Profile.");
  });
});
