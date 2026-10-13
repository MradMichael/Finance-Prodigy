// Session 20, item 1 (owner): foreign cash on the trip card.
//   - Each card shows each sheet's balance (the sheet's approved heading,
//     "EUR cash · balance €420.00") so what's left is in view while spending.
//   - "Spend from foreign cash" and "Record an exchange" open the SAME form
//     components the Currency screen uses, with Trip preset to this trip
//     (still changeable).
//   - Spending from the card: Trip preset, the sheet's balance drops, the
//     card's "Spent from EUR cash" updates, and the USD budget and net worth
//     don't move. An exchange from the card is tagged to that trip.
import { it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import TripsScreen from "./screens/TripsScreen";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, cycleStartDayOf, type LocalFinancials } from "../lib/localData";
import { computeDashboard, periodTotals } from "../lib/computeDashboard";
import { currentCycleKey } from "../lib/period";
import { buildExchange } from "../lib/foreignCash";
import type { StoredTrip } from "../lib/trips";

afterEach(cleanup);
// A trip far from today, so a form's date-based default would be "No trip":
// whatever the form shows comes from the card's preset.
const ROME: StoredTrip = { id: "trip-rome", name: "Rome", startDate: "2027-05-01", endDate: "2027-05-09", budgetUSD: 900, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" };
const LISBON: StoredTrip = { ...ROME, id: "trip-lis", name: "Lisbon", startDate: "2027-06-01", endDate: "2027-06-09" };
const EXCH = { ...buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500), tripId: "trip-rome" };
const START = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, lbpRateHistory: [], transactions: [EXCH], trips: [ROME, LISBON] } as LocalFinancials;

let latest: LocalFinancials = START;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <ThemeProvider><TripsScreen financials={d} onChange={setD} /></ThemeProvider>;
}
const rome = () => screen.getByRole("region", { name: "Rome" });

it("each card shows the sheet's balance, and the two buttons", () => {
  render(<Harness initial={START} />);
  expect(within(rome()).getByText("EUR cash · balance €460.00")).toBeTruthy();
  expect(within(rome()).getByRole("button", { name: "Spend from foreign cash" })).toBeTruthy();
  expect(within(rome()).getByRole("button", { name: "Record an exchange" })).toBeTruthy();
});

it("spending from the card: Trip preset; the balance drops; Spent from EUR cash updates; the USD budget and net worth don't move", () => {
  render(<Harness initial={START} />);
  const ym = currentCycleKey(new Date(), cycleStartDayOf(START));
  const before = { wants: periodTotals(START, ym, new Date()).wants, netWorth: computeDashboard(START).netWorth };
  fireEvent.click(within(rome()).getByRole("button", { name: "Spend from foreign cash" }));
  const form = within(rome()).getByRole("form", { name: "Spend from foreign cash" });
  expect((within(form).getByLabelText("Trip") as HTMLSelectElement).value).toBe("trip-rome");
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "40" } });
  fireEvent.change(within(form).getByLabelText("Description"), { target: { value: "Dinner" } });
  fireEvent.change(within(form).getByLabelText("Category"), { target: { value: "dining" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save spend" }));
  expect(within(rome()).getByText("EUR cash · balance €420.00")).toBeTruthy();
  expect(within(rome()).getByText("Spent from EUR cash: €40.00")).toBeTruthy();
  expect(within(rome()).getByText(/^Dining out: \$0\.00 counted · €40\.00 spent from cash/)).toBeTruthy(); // session 22, item 1d: in the category view
  expect(within(rome()).queryByRole("form", { name: "Spend from foreign cash" })).toBeNull();
  expect(latest.foreignEntries).toEqual([expect.objectContaining({ kind: "spend", amount: 40, tripId: "trip-rome" })]);
  expect(periodTotals(latest, ym, new Date()).wants).toBe(before.wants);
  expect(computeDashboard(latest).netWorth).toEqual(before.netWorth);
});

it("the preset Trip can still be changed", () => {
  render(<Harness initial={START} />);
  fireEvent.click(within(rome()).getByRole("button", { name: "Spend from foreign cash" }));
  const form = within(rome()).getByRole("form", { name: "Spend from foreign cash" });
  fireEvent.change(within(form).getByLabelText("Trip"), { target: { value: "trip-lis" } });
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "15" } });
  fireEvent.change(within(form).getByLabelText("Description"), { target: { value: "Tram" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save spend" }));
  expect(latest.foreignEntries![0].tripId).toBe("trip-lis");
});

// On the LATER trip's card: an exchange form left to itself would default to
// the next trip starting after today (Rome), so Lisbon here is the preset.
it("an exchange from the card is tagged to that trip", () => {
  render(<Harness initial={START} />);
  const lisbon = () => screen.getByRole("region", { name: "Lisbon" });
  fireEvent.click(within(lisbon()).getByRole("button", { name: "Record an exchange" }));
  const form = within(lisbon()).getByRole("form", { name: "Record an exchange" });
  expect((within(form).getByLabelText("Trip") as HTMLSelectElement).value).toBe("trip-lis");
  fireEvent.change(within(form).getByLabelText("Amount paid"), { target: { value: "200" } });
  fireEvent.change(within(form).getByLabelText("Amount received"), { target: { value: "184" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save exchange" }));
  const added = latest.transactions.find((t) => t.id !== EXCH.id)!;
  expect(added).toMatchObject({ bucket: "WANTS", category: "travel", amount: 200, fx: { code: "EUR", amount: 184, kind: "exchange" }, tripId: "trip-lis" });
  expect(within(lisbon()).getByText("EUR cash · balance €644.00")).toBeTruthy();
});

it("with no foreign cash yet: the card offers an exchange, not a spend, and shows no balance", () => {
  render(<Harness initial={{ ...START, transactions: [] } as LocalFinancials} />);
  expect(within(rome()).getByRole("button", { name: "Record an exchange" })).toBeTruthy();
  expect(within(rome()).queryByRole("button", { name: "Spend from foreign cash" })).toBeNull();
  expect(within(rome()).queryByText(/cash · balance/)).toBeNull();
});

it("two cards' forms don't share element ids", () => {
  render(<Harness initial={START} />);
  fireEvent.click(within(rome()).getByRole("button", { name: "Record an exchange" }));
  const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
  expect(new Set(ids).size).toBe(ids.length);
});
