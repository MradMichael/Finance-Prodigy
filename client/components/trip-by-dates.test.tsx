// Session 22, item 1b (owner; HELD): a spend dated inside a trip's dates
// defaults its Trip to that trip, still changeable to "No trip"; outside every
// trip it defaults to "No trip", and tagging an earlier booking by hand still
// works. In the main entry form and statement import (the foreign-cash spend
// form already did). The default follows the date until the person picks.
// Labels are the approved "Trip" and "No trip".
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputPanel from "./InputPanel";
import ImportStatement from "./ImportStatement";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredCard } from "../lib/localData";
import type { StoredTrip } from "../lib/trips";
import { parseNeoStatement, type ParseResult } from "../lib/statementImport/neoBankAudiParser";

vi.mock("../lib/statementImport/pdfText", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/statementImport/pdfText")>()),
  extractPositionedText: vi.fn(async () => []),
}));
vi.mock("../lib/statementImport/neoBankAudiParser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/statementImport/neoBankAudiParser")>()),
  parseNeoStatement: vi.fn(),
  guessAccountLast4: vi.fn(() => "4242"),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return local(d); };
const trip = (id: string, name: string, start: string, end: string): StoredTrip => ({ id, name, startDate: start, endDate: end, budgetUSD: 1000, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const NOW_TRIP = trip("now", "Lisbon", shift(-2), shift(5));
const OLD_TRIP = trip("old", "Rome", "2026-03-01", "2026-03-08");

function entryForm(trips: StoredTrip[] = [NOW_TRIP, OLD_TRIP]) {
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  const data = { ...DEFAULT_DATA, income: 3000, trips } as LocalFinancials;
  render(<ThemeProvider><InputPanel financials={data} dashData={computeDashboard(data)} onChange={onChange} onEdit={vi.fn()} onPay={vi.fn()} /></ThemeProvider>);
  const save = (amount: string) => {
    fireEvent.change(document.getElementById("tx-amount")!, { target: { value: amount } });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/ }));
    const written = onChange.mock.calls.at(-1)?.[0];
    if (!written) throw new Error("nothing saved");
    return written.transactions[0];
  };
  return { save, trip: () => screen.getByLabelText("Trip", { exact: true }) as HTMLSelectElement };
}

it("the entry form: dated today, inside a trip, the Trip defaults to it and is saved with the entry", () => {
  const { save, trip: field } = entryForm();
  expect(field().value).toBe("now");
  expect(save("25")).toMatchObject({ amount: 25, tripId: "now" });
});

it("the entry form: still changeable to No trip", () => {
  const { save, trip: field } = entryForm();
  fireEvent.change(field(), { target: { value: "" } });
  expect(save("25").tripId).toBeUndefined();
});

it("the entry form: dated outside every trip, No trip; an earlier booking can still be tagged by hand, and the pick holds when the date moves", async () => {
  const user = userEvent.setup();
  const { save, trip: field } = entryForm();
  await user.click(document.getElementById("tx-date")!); await user.keyboard("15062026");
  expect(field().value).toBe("");
  fireEvent.change(field(), { target: { value: "old" } });
  await user.click(document.getElementById("tx-date")!); await user.keyboard("16062026");
  expect(field().value).toBe("old");
  expect(save("40")).toMatchObject({ tripId: "old", date: "2026-06-16" });
});

it("the entry form: income defaults to No trip, even inside a trip", () => {
  const { trip: field } = entryForm();
  fireEvent.click(screen.getByRole("button", { name: /^📥\s*Income$/ }));
  expect(field().value).toBe("");
});

it("the entry form: with no trips there is no Trip field", () => {
  entryForm([]);
  expect(screen.queryByLabelText("Trip", { exact: true })).toBeNull();
});

const HELD: StoredCard = { id: "c-neo", type: "Other", last4: "4242", label: "NEO USD" };
it("statement import: each row dated inside a trip defaults to it, outside to No trip; changeable; saved with the row", async () => {
  const result: ParseResult = {
    transactions: [{ date: NOW_TRIP.startDate, description: "Pasteis de Belem", amount: 12 }, { date: "2026-06-15", description: "Spinneys", amount: 80 }],
    openingBalance: null, closingBalance: null, closingBalanceDate: null, unmatchedRefunds: [], skippedTransferCount: 0, unparsedAmountCount: 0, noRowsFound: false,
  };
  vi.mocked(parseNeoStatement).mockReturnValue(result);
  const onImport = vi.fn<(p: Partial<LocalFinancials>) => void>();
  const data = { ...DEFAULT_DATA, income: 3000, cards: [HELD], transactions: [], trackedBalances: [], trips: [NOW_TRIP, OLD_TRIP] } as LocalFinancials;
  const { container } = render(<ThemeProvider><ImportStatement financials={data} onImport={onImport} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] } });
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByRole("button", { name: /^Import 2 transactions/ });
  const trips = screen.getAllByLabelText("Trip", { exact: true }) as HTMLSelectElement[];
  expect(trips.map((t) => t.value)).toEqual(["now", ""]);
  fireEvent.change(trips[1], { target: { value: "old" } });
  fireEvent.click(screen.getByRole("button", { name: /^Import 2 transactions/ }));
  await waitFor(() => expect(onImport).toHaveBeenCalled());
  expect(onImport.mock.calls[0][0].transactions!.slice(0, 2).map((t) => [t.description, t.tripId])).toEqual([["Pasteis de Belem", "now"], ["Spinneys", "old"]]);
});
