// Owner, session 35 (T6's close part; the note approved the same session). At the close a dollar Cash
// balance takes the lira you have too, converted at the rate the close uses (the closing period's own rate,
// not today's: 2.4.134). The field reuses the approved "Lira you have now (L£)"; the note beneath is drafted:
// "Added to the dollars at the rate for the period being closed."
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type TrackedBalance } from "../../lib/localData";
import { currentCycleKey } from "../../lib/period";

afterEach(() => { cleanup(); });

const LIRA = "Lira you have now (L£)";
const NOTE = "Added to the dollars at the rate for the period being closed.";
const TB = (id: string, name: string, over: Partial<TrackedBalance> = {}): TrackedBalance => ({
  id, name, paymentMethod: "cash", currency: "USD",
  startingBalance: 100, startingDate: "2026-09-01", startingAt: "2026-09-01T09:00:00.000Z",
  actualBalance: 100, actualBalanceDate: "2026-09-01T09:00:00.000Z", expectedAtCheckUSD: 100, ...over,
});
function renderScreen(trackedBalances: TrackedBalance[]) {
  // Today's rate 100,000; the cycle being closed is at 89,500, the rate the close converts at.
  const key = currentCycleKey(new Date(), 27);
  const data = { ...DEFAULT_DATA, income: 3000, cycleStartDay: 27, lbpRate: 100_000, lbpRateHistory: [{ ym: key, value: 89_500 }], trackedBalances } as LocalFinancials;
  const onChange = vi.fn();
  render(<BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /close this cycle/i }));
  return onChange;
}
// The screen behind the dialog has its own check-in fields; every query here is the dialog's.
const dialog = () => within(screen.getByRole("dialog"));
const written = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)![0] as LocalFinancials;

it("a dollar Cash balance's close row has the lira field and the drafted note; a card's doesn't", () => {
  renderScreen([TB("cash", "Cash"), TB("visa", "Visa", { paymentMethod: "card" })]);
  expect(dialog().getAllByPlaceholderText(LIRA)).toHaveLength(1);
  expect(dialog().getAllByText(NOTE)).toHaveLength(1);
});

it("$100 and L£895,000 close at $110: the close's 89,500, not today's 100,000", () => {
  const onChange = renderScreen([TB("cash", "Cash")]);
  fireEvent.change(screen.getByLabelText(/what cash actually holds/i), { target: { value: "100" } });
  fireEvent.change(dialog().getByPlaceholderText(LIRA), { target: { value: "895000" } });
  fireEvent.click(screen.getByRole("button", { name: /^close cycle$/i }));
  const tb = written(onChange).trackedBalances!.find((t) => t.id === "cash")!;
  expect(tb.startingBalance).toBe(110);
});
