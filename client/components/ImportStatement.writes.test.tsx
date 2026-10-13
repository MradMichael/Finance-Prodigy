// TEST-02 (blind-spot audit, session 21): statement import STORES what it
// reads, and no test checked what it wrote. These pin it for a dollar card:
// each row as the statement gave it, on the chosen card, paid by card; a row
// already held arrives unticked and isn't imported; the closing balance
// becomes a new card's Balance Check, or re-anchors the one it has, as of the
// statement's own date. (A lira-tracked card is CUR-02, which waits on a
// decision: deliberately not pinned here.)
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import ImportStatement from "./ImportStatement";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredCard, type StoredTransaction, type TrackedBalance } from "../lib/localData";
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

afterEach(() => { cleanup(); vi.mocked(parseNeoStatement).mockReset(); });

const HELD: StoredCard = { id: "c-neo", type: "Other", last4: "4242", label: "NEO USD" };
const ROWS = [
  { date: "2026-10-03", description: "Bistro Margaux", amount: 46.8 },
  { date: "2026-10-05", description: "Spinneys Achrafieh", amount: 120 },
];
function statement(closingBalance: number | null = null, closingBalanceDate: string | null = null) {
  const result: ParseResult = {
    transactions: ROWS, openingBalance: null, closingBalance, closingBalanceDate, unmatchedRefunds: [], skippedTransferCount: 0, unparsedAmountCount: 0, noRowsFound: false,
  };
  vi.mocked(parseNeoStatement).mockReturnValue(result);
}
async function importInto(d: LocalFinancials, count: number) {
  const onImport = vi.fn<(p: Partial<LocalFinancials>) => void>();
  const { container } = render(<ThemeProvider><ImportStatement financials={d} onImport={onImport} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] } });
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: `Import ${count} transaction${count === 1 ? "" : "s"}` }));
  await waitFor(() => expect(onImport).toHaveBeenCalled());
  return onImport.mock.calls[0][0];
}
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, cards: [HELD], transactions: [], trackedBalances: [], ...o }) as LocalFinancials;

it("each row is stored as the statement gave it, on the chosen card, paid by card, ahead of what was there", async () => {
  statement();
  const before = { id: "t0", amount: 9, currency: "USD", bucket: "WANTS", description: "Earlier", date: "2026-09-01" } as StoredTransaction;
  const patch = await importInto(base({ transactions: [before] }), 2);
  expect(patch.transactions).toHaveLength(3);
  expect(patch.transactions!.slice(0, 2)).toEqual([
    expect.objectContaining({ date: "2026-10-03", description: "Bistro Margaux", amount: 46.8, currency: "USD", paymentMethod: "card", cardId: "c-neo", cardLabel: "NEO USD" }),
    expect.objectContaining({ date: "2026-10-05", description: "Spinneys Achrafieh", amount: 120, currency: "USD", paymentMethod: "card", cardId: "c-neo" }),
  ]);
  expect(patch.transactions![2]).toBe(before);
});

it("a row already held (same date, amount and description, whatever its case) arrives unticked and isn't imported", async () => {
  statement();
  const held = { id: "t0", amount: 46.8, currency: "USD", bucket: "WANTS", description: "BISTRO MARGAUX", date: "2026-10-03" } as StoredTransaction;
  const patch = await importInto(base({ transactions: [held] }), 1);
  expect(patch.transactions!.map((t) => t.description)).toEqual(["Spinneys Achrafieh", "BISTRO MARGAUX"]);
});

it("the closing balance becomes a new card's Balance Check, in dollars, as of the statement's date", async () => {
  statement(1234.56, "2026-10-07");
  const patch = await importInto(base({ cards: [] }), 2);
  const card = patch.cards![0];
  expect(patch.trackedBalances).toEqual([
    expect.objectContaining({ cardId: card.id, currency: "USD", startingBalance: 1234.56, startingDate: "2026-10-07", actualBalance: 1234.56, actualBalanceDate: "2026-10-07" }),
  ]);
});

it("or re-anchors the card's own dollar Balance Check to it", async () => {
  statement(800, "2026-10-07");
  const tb: TrackedBalance = { id: "tb1", name: "NEO USD", paymentMethod: "card", cardId: "c-neo", currency: "USD", startingBalance: 1000, startingDate: "2026-09-01" };
  const patch = await importInto(base({ trackedBalances: [tb] }), 2);
  expect(patch.trackedBalances).toHaveLength(1);
  expect(patch.trackedBalances![0]).toMatchObject({ id: "tb1", actualBalance: 800, startingBalance: 800 });
  expect(patch.trackedBalances![0].actualBalanceDate?.startsWith("2026-10-07")).toBe(true);
});
