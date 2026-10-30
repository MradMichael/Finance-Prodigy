// TEST-06's gap (session 24, item 9; tests only): statement import at size.
// Its duplicate check lives in the component (matchToCard since DI-04, session
// 30): each statement row against the existing transactions on the card it's
// imported to, on date and amount (and normalised description, for "Possible
// duplicate"). At 15,000 existing transactions (all on that card, so every one
// is compared) and a 500-row statement:
// - correctness: the 100 rows already held (spread through the 15,000, the
//   last at the very end, with a description in another case) arrive unticked
//   and aren't imported; the other 400 are;
// - time: the review and the import each finish inside a stated bound. The
//   measured times print as "SIZE:" lines for the report.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import ImportStatement from "./ImportStatement";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredCard, type StoredTransaction } from "../lib/localData";
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

const EXISTING = 15_000, ROWS = 500, HELD = 100;
const REVIEW_LIMIT_MS = 30_000, IMPORT_LIMIT_MS = 30_000;
const START = Date.UTC(2024, 10, 1);
const day = (i: number) => new Date(START + (i % 700) * 86_400_000).toISOString().slice(0, 10);
const NEO: StoredCard = { id: "c-neo", type: "Other", last4: "4242", label: "NEO" };

/** The statement: 500 rows; every fifth one (100 in all) is already held, matched to an existing row spread through the 15,000. */
function setUp() {
  const existing: StoredTransaction[] = Array.from({ length: EXISTING }, (_, i) => ({
    id: `t${i}`, amount: 1 + (i % 97), currency: "USD", bucket: "WANTS", description: `shop ${i}`, date: day(i),
    paymentMethod: "card", cardId: "c-neo", // DI-04 (session 30): held on the card being imported to
  }) as StoredTransaction);
  const rows = Array.from({ length: ROWS }, (_, k) => {
    if (k % 5 === 0) {
      const j = EXISTING - 1 - (k / 5) * 149; // spread back from the very last existing row
      return { date: existing[j].date, description: `SHOP ${j}`, amount: existing[j].amount };
    }
    return { date: day(20_000 + k), description: `New merchant ${k}`, amount: 1000 + k };
  });
  const result: ParseResult = { transactions: rows, openingBalance: null, closingBalance: null, closingBalanceDate: null, unmatchedRefunds: [], skippedTransferCount: 0, unparsedAmountCount: 0, noRowsFound: false };
  vi.mocked(parseNeoStatement).mockReturnValue(result);
  return { ...DEFAULT_DATA, income: 3000, cards: [NEO], transactions: existing, trackedBalances: [] } as LocalFinancials;
}

it("500 rows against 15,000: the 100 already held are unticked and not imported; the 400 new are", async () => {
  const data = setUp();
  const onImport = vi.fn<(p: Partial<LocalFinancials>) => void>();
  const { container } = render(<ThemeProvider><ImportStatement financials={data} onImport={onImport} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] } });
  const t0 = performance.now();
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  const go = await screen.findByRole("button", { name: `Import ${ROWS - HELD} transactions` }, { timeout: REVIEW_LIMIT_MS });
  const review = performance.now() - t0;
  const t1 = performance.now();
  fireEvent.click(go);
  await waitFor(() => expect(onImport).toHaveBeenCalled(), { timeout: IMPORT_LIMIT_MS });
  const commit = performance.now() - t1;
  console.log(`SIZE: review ${Math.round(review)} ms, import ${Math.round(commit)} ms (${EXISTING} existing, ${ROWS} rows)`);
  const written = onImport.mock.calls[0][0].transactions!;
  expect(written).toHaveLength(EXISTING + ROWS - HELD);
  const added = written.slice(0, ROWS - HELD);
  expect(added.every((t) => t.description.startsWith("New merchant"))).toBe(true);
  expect(review).toBeLessThan(REVIEW_LIMIT_MS);
  expect(commit).toBeLessThan(IMPORT_LIMIT_MS);
}, 120_000);
