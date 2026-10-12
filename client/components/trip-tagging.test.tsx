// Travel slice 2 (HELD; new wording DRAFT): tagging rows to a trip.
//   - The edit sheet: a Trip choice on any row. An exchange's two rows are
//     tagged together.
//   - The foreign-cash forms: a Trip choice that defaults to the trip whose
//     dates hold the form's date; the rows saved carry it (an exchange, both).
//   - The navigation has Trips, and it opens the Trips screen.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ThemeProvider } from "../contexts/ThemeContext";
import EditTransactionSheet from "./EditTransactionSheet";
import ForeignCashPanel from "./ForeignCashPanel";
import { NAV } from "./screens/shared";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";
import { buildExchange } from "../lib/foreignCash";
import type { StoredTrip } from "../lib/trips";

afterEach(cleanup);
const LISBON: StoredTrip = { id: "trip-lis", name: "Lisbon", startDate: "2026-10-01", endDate: "2026-10-09", budgetUSD: 1200, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" };
const fin = (transactions: StoredTransaction[] = [], trips: StoredTrip[] = [LISBON]) =>
  ({ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions, trips }) as LocalFinancials;

describe("the edit sheet", () => {
  const open = (t: StoredTransaction, all: StoredTransaction[]) => {
    const onChange = vi.fn();
    render(<ThemeProvider><EditTransactionSheet transaction={t} financials={fin(all)} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    return () => (onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions;
  };

  it("tags a spend to a trip, and untags it", () => {
    const dinner = { id: "d1", amount: 30, currency: "USD", bucket: "WANTS", description: "Dinner", date: "2026-10-03" } as StoredTransaction;
    const saved = open(dinner, [dinner]);
    fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "trip-lis" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(saved().find((t) => t.id === "d1")!.tripId).toBe("trip-lis");
    cleanup();
    const tagged = { ...dinner, tripId: "trip-lis" };
    const saved2 = open(tagged, [tagged]);
    expect((screen.getByLabelText("Trip") as HTMLSelectElement).value).toBe("trip-lis");
    fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(saved2().find((t) => t.id === "d1")!.tripId).toBeUndefined();
  });

  it("tagging either row of an exchange tags both", () => {
    const [src, pocket] = buildExchange({ date: "2026-10-03", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500);
    const saved = open(src, [src, pocket]);
    fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "trip-lis" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(saved().filter((t) => t.tripId === "trip-lis").map((t) => t.id).sort()).toEqual([src.id, pocket.id].sort());
  });
});

describe("the foreign-cash forms", () => {
  const setDate = (form: HTMLElement, iso: string) => fireEvent.change(form.querySelector('input[type="date"]')!, { target: { value: iso } });

  it("an exchange's Trip defaults to the trip holding its date, and both rows carry it", () => {
    const onChange = vi.fn();
    render(<ThemeProvider><ForeignCashPanel financials={fin()} onChange={onChange} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Record an exchange" }));
    const form = screen.getByRole("form", { name: "Record an exchange" });
    setDate(form, "2026-10-03");
    expect((within(form).getByLabelText("Trip") as HTMLSelectElement).value).toBe("trip-lis");
    fireEvent.change(within(form).getByLabelText("Amount paid"), { target: { value: "500" } });
    fireEvent.change(within(form).getByLabelText("Amount received"), { target: { value: "460" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save exchange" }));
    const rows = (onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions;
    expect(rows.map((t) => t.tripId)).toEqual(["trip-lis", "trip-lis"]);
  });

  it("outside any trip's dates: no trip, unless one is chosen", () => {
    const onChange = vi.fn();
    render(<ThemeProvider><ForeignCashPanel financials={fin()} onChange={onChange} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Record an exchange" }));
    const form = screen.getByRole("form", { name: "Record an exchange" });
    setDate(form, "2026-09-20");
    expect((within(form).getByLabelText("Trip") as HTMLSelectElement).value).toBe("");
    fireEvent.change(within(form).getByLabelText("Amount paid"), { target: { value: "100" } });
    fireEvent.change(within(form).getByLabelText("Amount received"), { target: { value: "92" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save exchange" }));
    expect((onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions.every((t) => t.tripId === undefined)).toBe(true);
  });

  it("a spend's Trip defaults the same way and the row carries it", () => {
    const exch = buildExchange({ date: "2026-10-02", paid: 500, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 460, description: "Exchange to EUR" }, 89_500);
    const onChange = vi.fn();
    render(<ThemeProvider><ForeignCashPanel financials={fin(exch)} onChange={onChange} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Spend from foreign cash" }));
    const form = screen.getByRole("form", { name: "Spend from foreign cash" });
    setDate(form, "2026-10-04");
    expect((within(form).getByLabelText("Trip") as HTMLSelectElement).value).toBe("trip-lis");
    fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "40" } });
    fireEvent.change(within(form).getByLabelText("Description"), { target: { value: "Dinner" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save spend" }));
    expect((onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions.find((t) => t.fx?.kind === "spend")!.tripId).toBe("trip-lis");
  });
});

it("the navigation has Trips", () => {
  expect(NAV.find((n) => n.key === "trips")).toMatchObject({ label: "Trips" });
});
