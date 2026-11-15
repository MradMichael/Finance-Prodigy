// InputPanel split, step S3 (docs/plans/phase-2.8.md; owner, session 52): the card lookup as one helper. Five forms
// each turned "paid by card, this saved card" into the row's cardId and cardLabel with their own copy of the same
// lines: the entry form, My Finances' Add to this goal, Goals' Add payment, the debt-payment sheet and the edit
// sheet. These pin what each stores, before and after they share lib/localData's cardRef: the picked card's id and
// label; and nothing when the method is Card but no card is picked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import InputPanel from "./InputPanel";
import GoalsScreen from "./screens/GoalsScreen";
import PayDebtSheet from "./PayDebtSheet";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, cardRef, type LocalFinancials, type StoredCard, type StoredDebt, type StoredGoal, type StoredTransaction } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0), toFake: ["Date"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const VISA: StoredCard = { id: "c1", type: "Visa", last4: "4821", label: "Visa •••• 4821" };
const AMEX: StoredCard = { id: "c2", type: "Amex", last4: "1005", label: "Amex •••• 1005" };
const GOAL: StoredGoal = { id: "g1", name: "Laptop", emoji: "L", targetAmount: 1200, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" };
const DEBT = { id: "d1", name: "Car loan", openingBalance: 5000, balance: 5000, apr: 9, minPayment: 150, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [VISA, AMEX], goals: [GOAL], debts: [DEBT], transactions: [], ...o }) as LocalFinancials;
const CARD = { cardId: "c2", cardLabel: "Amex •••• 1005" };

let latest: LocalFinancials;
function Panel({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} onEdit={vi.fn()} onPay={vi.fn()} />;
}
function Goals({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <ThemeProvider><GoalsScreen dashData={computeDashboard(d)} financials={d} onChange={setD} onEdit={vi.fn()} /></ThemeProvider>;
}
const press = (within_: HTMLElement, name: RegExp | string) => fireEvent.click(within(within_).getByRole("button", { name }));
const newest = () => latest.transactions[0];

describe("cardRef", () => {
  it("the picked card's id and label, when the method is card and the card is saved", () => {
    expect(cardRef([VISA, AMEX], "card", "c2")).toEqual(CARD);
  });
  it("nothing for cash or other, for no card picked, or for a card that isn't saved", () => {
    expect(cardRef([VISA], "cash", "c1")).toEqual({});
    expect(cardRef([VISA], "other", "c1")).toEqual({});
    expect(cardRef([VISA], "card", null)).toEqual({});
    expect(cardRef([VISA], "card", "gone")).toEqual({});
  });
});

describe("each form stores the picked card's id and label", () => {
  it("the entry form", () => {
    render(<Panel initial={base()} />);
    fireEvent.change(document.getElementById("tx-amount")!, { target: { value: "12" } });
    press(document.body, /Card$/);
    press(document.body, "Amex •••• 1005");
    press(document.body, /\+ Add entry/);
    expect(newest()).toMatchObject({ amount: 12, paymentMethod: "card", ...CARD });
  });

  it("the entry form, Card with no card picked: no card on the row", () => {
    render(<Panel initial={base()} />);
    fireEvent.change(document.getElementById("tx-amount")!, { target: { value: "12" } });
    press(document.body, /Card$/);
    press(document.body, /\+ Add entry/);
    expect(newest().paymentMethod).toBe("card");
    expect(newest().cardId).toBeUndefined();
    expect(newest().cardLabel).toBeUndefined();
  });

  it("My Finances: Add to this goal", () => {
    render(<Panel initial={base()} />);
    press(document.body, /Manage/);
    press(document.body, /Goals/);
    press(document.body, "Add to this goal");
    const form = screen.getByText("Add to this goal").parentElement!;
    fireEvent.change(within(form).getByPlaceholderText("Amount"), { target: { value: "100" } });
    press(form, /Card$/);
    press(form, "Amex •••• 1005");
    press(form, "Save");
    expect(newest()).toMatchObject({ amount: 100, goalId: "g1", paymentMethod: "card", ...CARD });
  });

  it("Goals: Add payment", () => {
    render(<Goals initial={base()} />);
    press(document.body, /Add payment/);
    fireEvent.change(screen.getByPlaceholderText(/Custom amount/), { target: { value: "100" } });
    press(document.body, /Card$/);
    press(document.body, "Amex •••• 1005");
    press(document.body, "Pay");
    expect(newest()).toMatchObject({ amount: 100, goalId: "g1", paymentMethod: "card", ...CARD });
  });

  it("the debt-payment sheet", () => {
    const onChange = vi.fn<(d: LocalFinancials) => void>();
    render(<ThemeProvider><PayDebtSheet debt={DEBT} financials={base()} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    fireEvent.change(document.getElementById("pay-debt-amount")!, { target: { value: "150" } });
    press(document.body, /Card$/);
    press(document.body, "Amex •••• 1005");
    press(document.body, "Save");
    expect(onChange.mock.calls[0][0].transactions[0]).toMatchObject({ amount: 150, debtId: "d1", paymentMethod: "card", ...CARD });
  });

  it("the edit sheet", () => {
    const TX = { id: "t1", amount: 20, currency: "USD", bucket: "WANTS", description: "Lunch", date: "2026-11-01", paymentMethod: "cash" } as StoredTransaction;
    const onChange = vi.fn<(d: LocalFinancials) => void>();
    render(<ThemeProvider><EditTransactionSheet transaction={TX} financials={base({ transactions: [TX] })} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    press(document.body, /Card$/);
    press(document.body, "Amex •••• 1005");
    press(document.body, "Save");
    expect(onChange.mock.calls[0][0].transactions.find((t) => t.id === "t1")).toMatchObject({ paymentMethod: "card", ...CARD });
  });

  it("the edit sheet, Card with no card picked: the row loses its card", () => {
    const TX = { id: "t1", amount: 20, currency: "USD", bucket: "WANTS", description: "Lunch", date: "2026-11-01", paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 4821" } as StoredTransaction;
    const onChange = vi.fn<(d: LocalFinancials) => void>();
    render(<ThemeProvider><EditTransactionSheet transaction={TX} financials={base({ transactions: [TX] })} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    press(document.body, /Card$/); // choosing the method again clears the picked card
    press(document.body, "Save");
    const saved = onChange.mock.calls[0][0].transactions.find((t) => t.id === "t1")!;
    expect(saved.cardId).toBeUndefined();
    expect(saved.cardLabel).toBeUndefined();
  });
});
