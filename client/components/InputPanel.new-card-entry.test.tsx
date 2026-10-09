// The lost-card bug (noticed in session 5, owner's item 6 in session 6).
//
// Logging an entry on My Finances with "+ New card" still open saved the
// card in one update and then the entry in a second update built from the
// older state. The second replaced the first: the entry pointed at a card id
// that was never stored, and the card never appeared in any picker. A
// stateful harness is needed to see it: with a bare vi.fn() parent both
// updates look fine on their own.
import { it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredCard } from "../lib/localData";

afterEach(cleanup);

let latest: LocalFinancials;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} onEdit={vi.fn()} onPay={vi.fn()} />;
}
const start = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, cards: [], transactions: [], ...o }) as LocalFinancials;
function typeNewCard(last4: string) {
  fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.trim().endsWith("Card") && !b.textContent.includes("New"))!);
  fireEvent.click(screen.getByRole("button", { name: "+ New card" }));
  fireEvent.change(document.getElementById("new-card-last4")!, { target: { value: last4 } });
}

it("an entry logged with a new card typed in keeps the card, and points at it", () => {
  render(<Harness initial={start()} />);
  typeNewCard("4242");
  fireEvent.change(document.getElementById("tx-amount")!, { target: { value: "46.8" } });
  fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));
  expect(latest.transactions).toHaveLength(1);
  expect(latest.cards.map((c) => c.last4)).toEqual(["4242"]);
  expect(latest.transactions[0]).toMatchObject({ cardId: latest.cards[0].id, cardLabel: "Visa •••• 4242" });
});

it("a split entry too: one card, both legs on it", () => {
  render(<Harness initial={start()} />);
  fireEvent.click(screen.getByRole("button", { name: "Split across USD and LBP?" }));
  typeNewCard("4242");
  fireEvent.change(document.getElementById("tx-split-usd")!, { target: { value: "10" } });
  fireEvent.change(document.getElementById("tx-split-lbp")!, { target: { value: "200000" } });
  fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));
  expect(latest.transactions).toHaveLength(2);
  expect(latest.cards).toHaveLength(1);
  expect(latest.transactions.every((t) => t.cardId === latest.cards[0].id)).toBe(true);
});

it("typing a card already held uses it: nothing added, the entry on that card", () => {
  const held: StoredCard = { id: "c-held", type: "Visa", last4: "4242", label: "Visa •••• 4242" };
  render(<Harness initial={start({ cards: [held] })} />);
  typeNewCard("4242");
  fireEvent.change(document.getElementById("tx-amount")!, { target: { value: "46.8" } });
  fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));
  expect(latest.cards).toEqual([held]);
  expect(latest.transactions[0].cardId).toBe("c-held");
});
