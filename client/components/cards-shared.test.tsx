// Plan H 5c on screen: every place that saves a card goes through the one
// shared saveCard. Typing a card already held (same type, same last four)
// uses that card and adds nothing; a new one is added, stamped with when.
// Before, each of these screens minted a second id for the same card.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import PayDebtSheet from "./PayDebtSheet";
import GoalsScreen from "./screens/GoalsScreen";
import EditTransactionSheet from "./EditTransactionSheet";
import BalanceCheckScreen from "./screens/BalanceCheckScreen";
import InputPanel from "./InputPanel";
import ImportStatement from "./ImportStatement";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredCard, type StoredDebt, type StoredTransaction } from "../lib/localData";

vi.mock("../lib/statementImport/pdfText", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/statementImport/pdfText")>()),
  extractPositionedText: vi.fn(async () => []),
}));
vi.mock("../lib/statementImport/neoBankAudiParser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/statementImport/neoBankAudiParser")>()),
  parseNeoStatement: vi.fn(() => ({
    transactions: [{ date: "2026-10-03", description: "Bistro Margaux", amount: 46.8 }],
    closingBalance: null, closingBalanceDate: null, unmatchedRefunds: [], skippedTransferCount: 0, unparsedAmountCount: 0, noRowsFound: false,
  })),
  guessAccountLast4: vi.fn(() => "4242"),
}));

const NOW = new Date("2026-10-08T12:00:00.000Z");
const HELD: StoredCard = { id: "c-held", type: "Visa", last4: "4242", label: "Visa •••• 4242" };
const DEBT = { id: "d1", name: "Card", openingBalance: 500, balance: 500, apr: 18, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, cards: [HELD], transactions: [], ...o }) as LocalFinancials;

let onChange: ReturnType<typeof vi.fn<(d: LocalFinancials) => void>>;
const cardsWritten = () => onChange.mock.calls.map((c) => (c[0] as LocalFinancials).cards).filter((c) => c !== undefined);
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  onChange = vi.fn<(d: LocalFinancials) => void>();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const cardMethod = () => fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.trim().endsWith("Card") && !b.textContent.includes("New"))!);
/** The shared CardPicker: "+ New card", the digits, "Save & use". */
function pickerSave(last4: string) {
  fireEvent.click(screen.getByRole("button", { name: "+ New card" }));
  fireEvent.change(document.getElementById("card-picker-new-last4")!, { target: { value: last4 } });
  fireEvent.click(screen.getByRole("button", { name: "Save & use" }));
}
/** Each screen: the held card is reused, a new one is added. */
function bothWays(open: () => void, save: (last4: string) => void) {
  it("a card already held is reused: nothing is added", () => {
    open(); save("4242");
    expect(cardsWritten().every((c) => c!.length === 1)).toBe(true);
  });
  it("a new card is added once, stamped with when", () => {
    open(); save("1111");
    const written = cardsWritten().at(-1)!;
    expect(written.map((c) => c.last4)).toEqual(["4242", "1111"]);
    expect(written[1].createdAt).toBe(NOW.toISOString());
  });
}

describe("Pay a debt", () => {
  bothWays(() => {
    const d = base({ debts: [DEBT] });
    render(<ThemeProvider><PayDebtSheet debt={DEBT} financials={d} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    cardMethod();
  }, pickerSave);
});

describe("Edit a transaction", () => {
  const TX = { id: "t1", amount: 46.8, currency: "USD", bucket: "WANTS", description: "Bistro Margaux", date: "2026-10-03" } as StoredTransaction;
  bothWays(() => {
    const d = base({ transactions: [TX] });
    render(<ThemeProvider><EditTransactionSheet transaction={TX} financials={d} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    cardMethod();
  }, pickerSave);
});

describe("Goals: a payment toward a goal", () => {
  bothWays(() => {
    const d = base({ goals: [{ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" }] });
    render(<ThemeProvider><GoalsScreen dashData={computeDashboard(d)} financials={d} onChange={onChange} onEdit={vi.fn()} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Add payment/ }));
    cardMethod();
  }, pickerSave);
});

describe("Balance Check: a tracked balance on a card", () => {
  bothWays(() => {
    const d = base();
    render(<ThemeProvider><BalanceCheckScreen financials={d} dashData={computeDashboard(d)} onChange={onChange} /></ThemeProvider>);
    cardMethod();
  }, pickerSave);
});

describe("My Finances: logging an entry", () => {
  bothWays(() => {
    const d = base();
    render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={onChange} onEdit={vi.fn()} onPay={vi.fn()} />);
    cardMethod();
  }, (last4) => {
    fireEvent.click(screen.getByRole("button", { name: "+ New card" }));
    fireEvent.change(document.getElementById("new-card-last4")!, { target: { value: last4 } });
    fireEvent.click(screen.getByRole("button", { name: "Save & use" }));
  });
});

describe("Statement import", () => {
  const importAs = async (d: LocalFinancials, chooseNew: boolean) => {
    const onImport = vi.fn<(p: Partial<LocalFinancials>) => void>();
    vi.useRealTimers();
    const { container } = render(<ThemeProvider><ImportStatement financials={d} onImport={onImport} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] } });
    await screen.findByRole("button", { name: "Continue" });
    if (chooseNew) fireEvent.change(container.querySelector("select")!, { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Import 1 transaction/ }));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    return onImport.mock.calls[0][0];
  };

  it("a new card whose digits match one already held (same type) is that card: nothing added, its own label kept", async () => {
    const held: StoredCard = { id: "c-neo", type: "Other", last4: "4242", label: "NEO USD" };
    const d = base({ cards: [held] });
    const patch = await importAs(d, true);
    expect(patch.cards).toEqual([held]);
    expect(patch.transactions?.[0]).toMatchObject({ cardId: "c-neo", cardLabel: "NEO USD" });
  });

  it("a card not held is added, with the label given", async () => {
    const patch = await importAs(base({ cards: [] }), false);
    expect(patch.cards).toHaveLength(1);
    expect(patch.cards?.[0]).toMatchObject({ type: "Other", last4: "4242", label: "NEO USD" });
    expect(patch.transactions?.[0].cardId).toBe(patch.cards?.[0].id);
  });
});
