// DI-20 (found in session 30 while planning item 9; the owner: fix it): a
// statement's own rows dated its closing day were counted twice. The
// re-anchored baseline is the end of the closing day; the imported rows carry
// the import's own time as createdAt, later than that, so the same-day tier
// (2.4.65: the clock breaks a tie on the boundary day) put them after the
// baseline and subtracted them from a closing balance that already held them.
// A statement's own rows are inside its closing balance, whenever they were
// imported. Rows typed by hand keep the clock rule.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import ImportStatement from "./ImportStatement";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, DEFAULT_LBP_RATE, isAfterBalanceBaseline, reanchorTrackedBalance, type LocalFinancials, type StoredCard, type StoredTransaction, type TrackedBalance } from "../lib/localData";
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

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 10, 12, 0)); }); // imported on 10 October
afterEach(() => { cleanup(); vi.useRealTimers(); vi.mocked(parseNeoStatement).mockReset(); });

const NEO: StoredCard = { id: "c-neo", type: "Other", last4: "4242", label: "NEO USD" };
const ROWS = [
  { date: "2026-10-03", description: "Bistro Margaux", amount: 30 },
  { date: "2026-10-07", description: "Spinneys Achrafieh", amount: 50 }, // on the closing day
];
function statement() {
  const result: ParseResult = { transactions: ROWS, openingBalance: null, closingBalance: 800, closingBalanceDate: "2026-10-07", unmatchedRefunds: [], skippedTransferCount: 0, unparsedAmountCount: 0, noRowsFound: false };
  vi.mocked(parseNeoStatement).mockReturnValue(result);
}
async function importInto(d: LocalFinancials): Promise<LocalFinancials> {
  statement();
  const onImport = vi.fn<(p: Partial<LocalFinancials>) => void>();
  const { container } = render(<ThemeProvider><ImportStatement financials={d} onImport={onImport} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] } });
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: "Import 2 transactions" }));
  await waitFor(() => expect(onImport).toHaveBeenCalled());
  return { ...d, ...onImport.mock.calls[0][0] } as LocalFinancials;
}
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, cards: [NEO], transactions: [], trackedBalances: [], ...o }) as LocalFinancials;
const expectedNow = (d: LocalFinancials) => computeDashboard(d).balanceChecks[0].nowNative;
const TB: TrackedBalance = { id: "tb1", name: "NEO USD", paymentMethod: "card", cardId: "c-neo", currency: "USD", startingBalance: 1000, startingDate: "2026-09-01" };

describe("DI-20: a statement's own closing-day rows are inside its closing balance", () => {
  it("re-anchored by an $800 statement with a $50 row on its closing day: \"Expected now\" $800 (it read $750)", async () => {
    expect(expectedNow(await importInto(base({ trackedBalances: [TB] })))).toBe(800);
  });

  it("a new card's first statement: the same, $800", async () => {
    expect(expectedNow(await importInto(base()))).toBe(800);
  });

  it("a row typed by hand afterwards, dated the closing day, still counts after the statement (the clock rule, unchanged)", async () => {
    const d = await importInto(base({ trackedBalances: [TB] }));
    const typed = { id: "t-typed", amount: 20, currency: "USD", bucket: "WANTS", description: "Kiosk", date: "2026-10-07", paymentMethod: "card", cardId: "c-neo", createdAt: "2026-10-10T13:00:00.000Z" } as StoredTransaction;
    expect(expectedNow({ ...d, transactions: [typed, ...d.transactions] })).toBe(780);
  });

  it("a later check-in starts a baseline of its own: the statement's mark is cleared", async () => {
    const d = await importInto(base({ trackedBalances: [TB] }));
    const checked = reanchorTrackedBalance(d.trackedBalances[0], 790, 790, DEFAULT_LBP_RATE);
    expect(checked.startingImportId).toBeUndefined();
  });
});

describe("DI-20: the rule", () => {
  const tb = { startingDate: "2026-10-07", startingAt: "2026-10-07T20:59:59.999Z", startingImportId: "imp-1" };
  const row = (o: Partial<StoredTransaction>) => ({ date: "2026-10-07", createdAt: "2026-10-10T09:00:00.000Z", ...o });
  it("a row from the baseline's own statement is before it, whenever it was created", () => {
    expect(isAfterBalanceBaseline(row({ statementImportId: "imp-1" }), tb)).toBe(false);
  });
  it("a row from another import, or typed by hand, follows the clock on the boundary day", () => {
    expect(isAfterBalanceBaseline(row({ statementImportId: "imp-2" }), tb)).toBe(true);
    expect(isAfterBalanceBaseline(row({}), tb)).toBe(true);
  });
});
