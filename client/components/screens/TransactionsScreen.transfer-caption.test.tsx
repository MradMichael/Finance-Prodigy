// Owner, session 15, item 3: a transfer's two rows were captioned "⇄ split
// payment", which they aren't: they're one movement between two of the
// owner's own pools. An ordinary transfer's rows now say "⇄ transfer · also"
// the other row's amount (session 16; lira in lira), unsigned on both rows
// (session 17: "⇄ transfer · also $200.00", not "$-200.00" on the incoming
// row). A real split payment (one purchase paid in two currencies, two linked
// spending rows) keeps "⇄ split payment · also …".
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import TransactionsScreen from "./TransactionsScreen";
import { DEFAULT_DATA, buildTransferTx, todayISO, type LocalFinancials, type StoredTransaction } from "../../lib/localData";

afterEach(cleanup);
const show = (transactions: StoredTransaction[]) =>
  render(<TransactionsScreen financials={{ ...DEFAULT_DATA, transactions } as LocalFinancials} onChange={vi.fn()} onEdit={vi.fn()} />);

it("an ordinary transfer's two rows each say \"⇄ transfer · also\" the other row's amount, unsigned", () => {
  const legs = buildTransferTx(200, "USD", { paymentMethod: "card", label: "Card" }, { paymentMethod: "cash", label: "Cash" }, 89_500, { date: todayISO() });
  show(legs);
  // Each row names the other row's amount without its sign: the card row (the cash row's +200) and the cash row (the card row's -200) alike.
  expect(screen.getByText("Transfer to Cash").parentElement!.textContent).toContain("⇄ transfer · also $200.00");
  expect(screen.getByText("Transfer from Card").parentElement!.textContent).toContain("⇄ transfer · also $200.00");
  expect(screen.getAllByText("⇄ transfer · also $200.00")).toHaveLength(2);
  expect(screen.queryByText(/also \$-/)).toBeNull();
  expect(screen.queryByText(/split payment/)).toBeNull();
});

it("a lira transfer's amount is in lira, unsigned on both rows", () => {
  const legs = buildTransferTx(900_000, "LBP", { paymentMethod: "cash", label: "Cash" }, { paymentMethod: "other", label: "Other" }, 89_500, { date: todayISO() });
  show(legs);
  expect(screen.getAllByText("⇄ transfer · also L£900,000")).toHaveLength(2);
  expect(screen.queryByText(/also L£-/)).toBeNull();
});

it("a real split payment keeps its caption, naming the other part", () => {
  const day = todayISO();
  const usd: StoredTransaction = { id: "s1", amount: 20, currency: "USD", bucket: "WANTS", description: "Dinner", date: day, linkedPaymentId: "L1" };
  const lbp: StoredTransaction = { id: "s2", amount: 900_000, currency: "LBP", bucket: "WANTS", description: "Dinner", date: day, linkedPaymentId: "L1" };
  show([usd, lbp]);
  expect(screen.getByText("⇄ split payment · also L£900,000")).toBeTruthy();
  expect(screen.getByText("⇄ split payment · also $20.00")).toBeTruthy();
  expect(screen.queryByText(/⇄ transfer/)).toBeNull();
});
