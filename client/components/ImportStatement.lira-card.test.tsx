// Session 24, item 3 (owner; plan J's day rate): CUR-02. A statement is in
// dollars. Imported into a card whose Balance Check is in lira, its closing
// balance was stored as lira verbatim: $1,234.56 became L£1,234.56 (about one
// cent), since the re-anchor keeps its figure in the balance's own currency.
// It's now converted at the statement's closing day's rate first.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import ImportStatement from "./ImportStatement";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredCard, type TrackedBalance } from "../lib/localData";
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

const NEO: StoredCard = { id: "c-neo", type: "Other", last4: "4242", label: "NEO" };
const LIRA_TB: TrackedBalance = { id: "tb1", name: "NEO", paymentMethod: "card", cardId: "c-neo", currency: "LBP", startingBalance: 4_475_000, startingDate: "2026-09-01" };
function statement(closingBalance: number, closingBalanceDate: string) {
  const result: ParseResult = {
    transactions: [{ date: "2026-10-03", description: "Bistro Margaux", amount: 46.8 }], openingBalance: null, closingBalance, closingBalanceDate,
    unmatchedRefunds: [], skippedTransferCount: 0, unparsedAmountCount: 0, noRowsFound: false,
  };
  vi.mocked(parseNeoStatement).mockReturnValue(result);
}
async function importInto(d: LocalFinancials) {
  const onImport = vi.fn<(p: Partial<LocalFinancials>) => void>();
  const { container } = render(<ThemeProvider><ImportStatement financials={d} onImport={onImport} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] } });
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1 transaction" }));
  await waitFor(() => expect(onImport).toHaveBeenCalled());
  return onImport.mock.calls[0][0];
}
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [NEO], transactions: [], trackedBalances: [LIRA_TB], ...o }) as LocalFinancials;

it("a dollar closing balance re-anchors a lira Balance Check in lira, at the statement day's rate: $1,234.56 → L£110,493,120", async () => {
  statement(1234.56, "2026-10-07");
  const patch = await importInto(base());
  expect(patch.trackedBalances![0]).toMatchObject({ id: "tb1", currency: "LBP", actualBalance: 110_493_120, startingBalance: 110_493_120 });
});

it("the rate is the one on the statement's own day, not today's: L£123,456,000 at the logged 100,000", async () => {
  statement(1234.56, "2026-10-07");
  const patch = await importInto(base({ lbpRate: 179_000, lbpRateLog: [{ from: "2026-10-01", value: 100_000 }, { from: "2026-10-12", value: 179_000 }] }));
  expect(patch.trackedBalances![0]).toMatchObject({ actualBalance: 123_456_000, startingBalance: 123_456_000 });
});

it("the imported rows stay in dollars, the statement's currency", async () => {
  statement(1234.56, "2026-10-07");
  const patch = await importInto(base());
  expect(patch.transactions![0]).toMatchObject({ amount: 46.8, currency: "USD" });
});
