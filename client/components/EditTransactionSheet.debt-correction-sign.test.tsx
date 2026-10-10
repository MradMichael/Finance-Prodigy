// DI-02: the Debt correction field in Edit transaction showed the stored
// debtAdjustment as it is, while the help text under it, "Positive increases
// the debt, negative reduces it further.", described the opposite sign. The
// stored convention is derivedDebtBalance = openingBalance - (amount +
// debtAdjustment): a NEGATIVE stored value raises the debt (Edit Debt writes
// current - entered). Following the text moved the debt the wrong way, by
// twice the correction. And the field stripped a typed minus sign, so the
// text's "negative" couldn't be entered at all. The field now shows and takes
// the sign the text describes, negatives included; what's stored keeps its
// convention, and the text is unchanged.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, derivedDebtBalance, type LocalFinancials, type StoredDebt, type StoredTransaction } from "../lib/localData";

afterEach(cleanup);

const HELP = "Positive increases the debt, negative reduces it further.";
const DEBT = { id: "d1", name: "Car loan", openingBalance: 5000, balance: 5000, apr: 9, minPayment: 150, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
// Edit Debt's own record of a $300 lender fee: the balance went from 5,000 to 5,300.
const FEE = { id: "t1", amount: 0, currency: "USD", bucket: "SAVINGS", description: "Debt correction: Car loan", date: "2026-10-01", debtId: "d1", debtAdjustment: -300 } as StoredTransaction;

function open() {
  const data = { ...DEFAULT_DATA, income: 3000, debts: [DEBT], transactions: [FEE] } as LocalFinancials;
  expect(derivedDebtBalance(DEBT, data.transactions)).toBe(5300);
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><EditTransactionSheet transaction={FEE} financials={data} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  const box = screen.getByText(HELP).parentElement!;
  const field = box.querySelector("input")!;
  const saved = () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const out = onChange.mock.calls.at(-1)![0];
    return { tx: out.transactions.find((t) => t.id === "t1")!, balance: derivedDebtBalance(DEBT, out.transactions) };
  };
  return { field, saved };
}

it("a correction that raised the debt reads as positive, as the text beside it says", () => {
  const { field } = open();
  expect(field.value).toBe("300");
});

it("saving it unchanged keeps the debt where it is", () => {
  const { saved } = open();
  const { tx, balance } = saved();
  expect(tx.debtAdjustment).toBe(-300);
  expect(balance).toBe(5300);
});

it("a larger positive number increases the debt further, as the text says", () => {
  const { field, saved } = open();
  fireEvent.change(field, { target: { value: "400" } });
  expect(saved().balance).toBe(5400);
});

it("a negative number can be typed, and reduces it, as the text says", () => {
  const { field, saved } = open();
  fireEvent.change(field, { target: { value: "-50" } });
  expect(field.value).toBe("-50"); // the field used to strip the minus sign
  const { tx, balance } = saved();
  expect(tx.debtAdjustment).toBe(50);
  expect(balance).toBe(4950);
});

it("zero stores zero, not minus zero", () => {
  const { field, saved } = open();
  fireEvent.change(field, { target: { value: "0" } });
  expect(Object.is(saved().tx.debtAdjustment, 0)).toBe(true);
});

it("a correction that lowered the debt reads as negative, and keeps its sign when edited", () => {
  const LOWER = { ...FEE, id: "t2", debtAdjustment: 50 } as StoredTransaction; // balance 5,000 -> 4,950
  const data = { ...DEFAULT_DATA, income: 3000, debts: [DEBT], transactions: [LOWER] } as LocalFinancials;
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><EditTransactionSheet transaction={LOWER} financials={data} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  const field = screen.getByText(HELP).parentElement!.querySelector("input")!;
  expect(field.value).toBe("-50");
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "-60" } });
  fireEvent.blur(field);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const out = onChange.mock.calls.at(-1)![0];
  expect(out.transactions[0].debtAdjustment).toBe(60);
  expect(derivedDebtBalance(DEBT, out.transactions)).toBe(4940);
});

it("the minus sign stays a leading sign: one, in front", async () => {
  const { field } = open();
  // Session 10, item 6: the field shows its bare figure from the end of the focusing task.
  const focus = async () => { fireEvent.focus(field); await new Promise((r) => setTimeout(r, 0)); };
  await focus();
  fireEvent.change(field, { target: { value: "1-2-3" } });
  expect(field.value).toBe("123");
  fireEvent.change(field, { target: { value: "--1,250" } });
  expect(field.value).toBe("-1250");
  fireEvent.blur(field);
  expect(field.value).toBe("-1,250");
  // The field's ceiling bounds a negative too (USD: 100,000,000).
  await focus();
  fireEvent.change(field, { target: { value: "-200000000" } });
  fireEvent.blur(field);
  expect(field.value).toBe("-100,000,000");
  // A minus typed alone shows as itself, not as a number it isn't.
  await focus();
  fireEvent.change(field, { target: { value: "-" } });
  fireEvent.blur(field);
  expect(field.value).toBe("-");
});

it("every other money field still refuses a minus sign: the amount, here", () => {
  open();
  const amount = document.getElementById("edit-tx-amount") as HTMLInputElement;
  fireEvent.focus(amount);
  fireEvent.change(amount, { target: { value: "-5" } });
  expect(amount.value).toBe("5");
});
