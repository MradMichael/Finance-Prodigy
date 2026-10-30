// DI-04 (owner, session 30, DECISIONS_PENDING entry 7 (a)): a re-imported
// statement row is matched on date, amount and card, not on its description,
// which the person may have edited. On the card being imported to: the same
// date and amount, and the same description too, is "Possible duplicate"
// (the existing sentence); a different description is "possibly the same"
// (a new label, drafted in session 30, approved and merged in session 31). Both start unticked. Matched when the
// card is chosen (Continue), since the rows are read before it.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
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

const NEO: StoredCard = { id: "c-neo", type: "Other", last4: "4242", label: "NEO USD" };
const OTHER: StoredCard = { id: "c-other", type: "Visa", last4: "1111", label: "Visa •••• 1111" };
const ROWS = [
  { date: "2026-09-12", description: "SPINNEYS ACHRAFIEH 1234", amount: 42.5 },
  { date: "2026-09-14", description: "Bistro Margaux", amount: 46.8 },
];
const POSSIBLE_DUPLICATE = /^Possible duplicate: same date, amount, and description/;
const POSSIBLY_SAME = "Possibly the same: a transaction on this card has the same date and amount, with a different description. Left unchecked; check the box above if it's a separate purchase.";

function statement() {
  const result: ParseResult = { transactions: ROWS, openingBalance: null, closingBalance: null, closingBalanceDate: null, unmatchedRefunds: [], skippedTransferCount: 0, unparsedAmountCount: 0, noRowsFound: false };
  vi.mocked(parseNeoStatement).mockReturnValue(result);
}
const held = (o: Partial<StoredTransaction>) =>
  ({ id: "t-held", amount: 42.5, currency: "USD", bucket: "NEEDS", description: "Groceries at Spinneys", date: "2026-09-12", paymentMethod: "card", cardId: "c-neo", cardLabel: "NEO USD", ...o }) as StoredTransaction;
async function review(d: LocalFinancials, pick?: (select: HTMLSelectElement) => void) {
  statement();
  const { container } = render(<ThemeProvider><ImportStatement financials={d} onImport={vi.fn()} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] } });
  const cont = await screen.findByRole("button", { name: "Continue" });
  if (pick) pick(container.querySelector("select") as HTMLSelectElement);
  fireEvent.click(cont);
  await screen.findByText(/selected\./);
}
const rowOf = (description: string) => (screen.getByDisplayValue(description).closest("div.rounded-xl") as HTMLElement);
const ticked = (description: string) => (within(rowOf(description)).getByRole("checkbox") as HTMLInputElement).checked;
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, cards: [NEO, OTHER], transactions: [], trackedBalances: [], ...o }) as LocalFinancials;

it("the write-up's example: the row was renamed \"Groceries at Spinneys\"; re-imported, it's \"possibly the same\", unticked", async () => {
  await review(base({ transactions: [held({})] }));
  expect(within(rowOf("SPINNEYS ACHRAFIEH 1234")).getByText(POSSIBLY_SAME)).toBeTruthy();
  expect(ticked("SPINNEYS ACHRAFIEH 1234")).toBe(false);
  expect(ticked("Bistro Margaux")).toBe(true);
  expect(screen.getByRole("button", { name: "Import 1 transaction" })).toBeTruthy();
});

it("the same date, amount and description on this card: \"Possible duplicate\", unticked", async () => {
  await review(base({ transactions: [held({ description: "Spinneys Achrafieh 1234" })] }));
  expect(within(rowOf("SPINNEYS ACHRAFIEH 1234")).getByText(POSSIBLE_DUPLICATE)).toBeTruthy();
  expect(within(rowOf("SPINNEYS ACHRAFIEH 1234")).queryByText(POSSIBLY_SAME)).toBeNull();
  expect(ticked("SPINNEYS ACHRAFIEH 1234")).toBe(false);
});

it("the same date and amount on another card: not matched, ticked", async () => {
  await review(base({ transactions: [held({ cardId: "c-other", cardLabel: OTHER.label, description: "SPINNEYS ACHRAFIEH 1234" })] }));
  expect(within(rowOf("SPINNEYS ACHRAFIEH 1234")).queryByText(POSSIBLE_DUPLICATE)).toBeNull();
  expect(within(rowOf("SPINNEYS ACHRAFIEH 1234")).queryByText(POSSIBLY_SAME)).toBeNull();
  expect(ticked("SPINNEYS ACHRAFIEH 1234")).toBe(true);
});

it("a deleted transaction doesn't match", async () => {
  await review(base({ transactions: [held({ deletedAt: "2026-09-20T10:00:00.000Z" })] }));
  expect(ticked("SPINNEYS ACHRAFIEH 1234")).toBe(true);
});

it("a new card whose four digits a held card has is that card, and its rows match", async () => {
  await review(base({ transactions: [held({})] }), (select) => fireEvent.change(select, { target: { value: "new" } }));
  expect(within(rowOf("SPINNEYS ACHRAFIEH 1234")).getByText(POSSIBLY_SAME)).toBeTruthy();
  expect(ticked("SPINNEYS ACHRAFIEH 1234")).toBe(false);
});

it("a cent apart isn't the same amount", async () => {
  await review(base({ transactions: [held({ amount: 42.51 })] }));
  expect(ticked("SPINNEYS ACHRAFIEH 1234")).toBe(true);
});
