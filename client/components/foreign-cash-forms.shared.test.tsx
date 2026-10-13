// Session 20, item 1 (owner: "the SAME form components the Currency screen
// uses (no copies)"): the Currency screen's foreign-cash panel and the trip
// card both render ForeignCashForms' ExchangeForm and SpendForm. Proved by
// standing in for the module: each screen must render the stand-ins, with the
// card passing its trip as the preset.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

const rendered: { form: string; presetTripId?: string }[] = [];
vi.mock("./ForeignCashForms", () => ({
  ExchangeForm: (p: { presetTripId?: string }) => { rendered.push({ form: "exchange", presetTripId: p.presetTripId }); return <p>exchange form stand-in</p>; },
  SpendForm: (p: { presetTripId?: string }) => { rendered.push({ form: "spend", presetTripId: p.presetTripId }); return <p>spend form stand-in</p>; },
  TripSelect: () => null,
}));

import ForeignCashPanel from "./ForeignCashPanel";
import TripsScreen from "./screens/TripsScreen";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";
import { buildExchange } from "../lib/foreignCash";

afterEach(() => { cleanup(); rendered.length = 0; });
const ROME = { id: "trip-rome", name: "Rome", startDate: "2027-05-01", endDate: "2027-05-09", budgetUSD: 900, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" };
const D = { ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], trips: [ROME],
  transactions: [buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500)] } as LocalFinancials;

it("the Currency screen's panel renders the shared forms, with no preset trip", () => {
  render(<ThemeProvider><ForeignCashPanel financials={D} onChange={vi.fn()} /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Record an exchange" }));
  fireEvent.click(screen.getByRole("button", { name: "Spend from foreign cash" }));
  expect(rendered.map((r) => r.form)).toEqual(expect.arrayContaining(["exchange", "spend"]));
  expect(rendered.every((r) => r.presetTripId === undefined)).toBe(true);
});

it("the trip card renders the same shared forms, presetting its own trip", () => {
  render(<ThemeProvider><TripsScreen financials={D} onChange={vi.fn()} /></ThemeProvider>);
  const card = screen.getByRole("region", { name: "Rome" });
  fireEvent.click(within(card).getByRole("button", { name: "Record an exchange" }));
  expect(rendered.at(-1)).toEqual({ form: "exchange", presetTripId: "trip-rome" });
  fireEvent.click(within(card).getByRole("button", { name: "Spend from foreign cash" }));
  expect(rendered.at(-1)).toEqual({ form: "spend", presetTripId: "trip-rome" });
});
