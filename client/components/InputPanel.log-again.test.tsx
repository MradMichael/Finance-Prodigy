// Session 52, item 18; merged in session 53. Labels approved by the owner: "Log again", named for screen readers and
// voice control "Log again: {description}" (session 53: the name starts with the words on the button). On a row in My
// Finances' This month or History, "Log again" fills the Log an entry form from that row, dated today, and saves
// nothing: "+ Add entry" does that, with the form's own checks. Only an ordinary entry offers it; a transfer, a
// goal contribution, a debt payment, a confirmed recurring bill, a foreign-cash row and a split's part are each
// made by their own form.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredCard, type StoredTransaction } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0), toFake: ["Date"] }); Element.prototype.scrollIntoView = vi.fn(); }); // 13 November 2026
afterEach(() => { cleanup(); vi.useRealTimers(); });

const VISA: StoredCard = { id: "c1", type: "Visa", last4: "4821", label: "Visa •••• 4821" };
const tx = (o: Partial<StoredTransaction>): StoredTransaction => ({ id: "t1", amount: 4.5, currency: "USD", bucket: "WANTS", description: "Flat white", date: "2026-11-03", paymentMethod: "cash", createdAt: "2026-11-03T08:00:00.000Z", ...o }) as StoredTransaction;
const base = (transactions: StoredTransaction[], o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [VISA], transactions, ...o }) as LocalFinancials;

let latest: LocalFinancials;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} onEdit={vi.fn()} onPay={vi.fn()} />;
}
const AGAIN = { name: /^Log again: / };
const value = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value;
const pressed = (name: RegExp) => screen.getAllByRole("button", { name }).some((b) => b.getAttribute("aria-pressed") === "true");
const rowOf = (text: string) => screen.getByText(text).closest("[data-entry-row]") as HTMLElement;

describe("Log again, from This month", () => {
  it("the button reads \"Log again\" and is named \"Log again: {description}\"", () => {
    render(<Harness initial={base([tx({})])} />);
    const b = within(rowOf("Flat white")).getByRole("button", { name: "Log again: Flat white" });
    expect(b.textContent).toBe("Log again");
    // WCAG 2.5.3: the name starts with the visible words, so "click Log again" finds it.
    expect(b.getAttribute("aria-label")!.startsWith(b.textContent!)).toBe(true);
    expect(screen.queryByRole("button", { name: "Log this entry again" })).toBeNull();
  });

  it("fills the form from the row, dated today, and stores nothing", () => {
    render(<Harness initial={base([tx({ category: "dining", paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 4821" })])} />);
    fireEvent.click(within(rowOf("Flat white")).getByRole("button", AGAIN));
    expect(value("tx-amount")).toBe("4.5");
    expect(value("tx-desc")).toBe("Flat white");
    expect(value("tx-category")).toBe("dining");
    expect(pressed(/Wants$/)).toBe(true);
    expect(pressed(/^\$ USD$/)).toBe(true);
    expect(pressed(/Card$/)).toBe(true);
    expect(pressed(/^Visa •••• 4821$/)).toBe(true);
    expect((document.getElementById("tx-date")!.parentElement!.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-11-13");
    expect(latest.transactions).toHaveLength(1);
  });

  it("\"+ Add entry\" then stores one new row, dated today, and the old row is as it was", () => {
    const old = tx({ category: "dining" });
    render(<Harness initial={base([old])} />);
    fireEvent.click(within(rowOf("Flat white")).getByRole("button", AGAIN));
    fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));
    expect(latest.transactions).toHaveLength(2);
    expect(latest.transactions[0]).toMatchObject({ amount: 4.5, currency: "USD", bucket: "WANTS", description: "Flat white", category: "dining", date: "2026-11-13", paymentMethod: "cash" });
    expect(latest.transactions[0].id).not.toBe("t1");
    expect(latest.transactions[1]).toEqual(old);
  });

  it("a lira row keeps its lira amount; saved, it takes today's rate", () => {
    render(<Harness initial={base([tx({ amount: 250_000, currency: "LBP", lbpRateAtEntry: 80_000, description: "Manoushe" })])} />);
    fireEvent.click(within(rowOf("Manoushe")).getByRole("button", AGAIN));
    expect(value("tx-amount")).toBe("250,000");
    expect(pressed(/^L£ LBP$/)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));
    expect(latest.transactions[0]).toMatchObject({ amount: 250_000, currency: "LBP", lbpRateAtEntry: 89_500 });
  });

  it("an \"Other\" note comes too; a card that's gone falls back to Cash", () => {
    render(<Harness initial={base([
      tx({ id: "t1", description: "Petrol", paymentMethod: "other", paymentNote: "Dad paid" }),
      tx({ id: "t2", description: "Books", paymentMethod: "card", cardId: "gone", cardLabel: "Amex •••• 1005" }),
    ])} />);
    fireEvent.click(within(rowOf("Petrol")).getByRole("button", AGAIN));
    expect(pressed(/Other$/)).toBe(true);
    expect(screen.getByDisplayValue("Dad paid")).toBeTruthy();
    fireEvent.click(within(rowOf("Books")).getByRole("button", AGAIN));
    expect(pressed(/Cash$/)).toBe(true);
    expect(pressed(/Card$/)).toBe(false);
  });

  it("an income row sets the type to Income", () => {
    render(<Harness initial={base([tx({ bucket: "INCOME", description: "Freelance job", amount: 200 })])} />);
    fireEvent.click(within(rowOf("Freelance job")).getByRole("button", AGAIN));
    expect(pressed(/Income$/)).toBe(true);
  });

  it("with the split form open, it goes back to the single amount", () => {
    render(<Harness initial={base([tx({})])} />);
    fireEvent.click(screen.getByRole("button", { name: /Split across USD and LBP\?/ }));
    expect(document.getElementById("tx-split-usd")).toBeTruthy();
    fireEvent.click(within(rowOf("Flat white")).getByRole("button", AGAIN));
    expect(document.getElementById("tx-split-usd")).toBeNull();
    expect(value("tx-amount")).toBe("4.5");
  });
});

describe("Log again, from History", () => {
  it("a past month's row fills the form the same way", () => {
    render(<Harness initial={base([tx({ date: "2026-10-18", description: "Cinema night", amount: 42.5 })])} />);
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    fireEvent.click(within(rowOf("Cinema night")).getByRole("button", { name: "Log again: Cinema night" }));
    expect(value("tx-amount")).toBe("42.5");
    expect(value("tx-desc")).toBe("Cinema night");
    expect(latest.transactions).toHaveLength(1);
  });
});

describe("rows made by another form don't offer it", () => {
  const kinds: [string, Partial<StoredTransaction>][] = [
    ["a transfer", { bucket: "TRANSFER", description: "Transfer to Cash", linkedPaymentId: "p1" }],
    ["a goal contribution", { bucket: "SAVINGS", description: "Goal: Laptop", goalId: "g1" }],
    ["a debt payment", { bucket: "NEEDS", description: "Car loan payment", debtId: "d1" }],
    ["a confirmed recurring bill", { bucket: "NEEDS", description: "Rent", recurringId: "r1", cycleDate: "2026-11-01" }],
    ["one part of a split payment", { description: "Dinner (USD part)", linkedPaymentId: "p2" }],
    ["a foreign-cash row", { description: "Changed to EUR", fx: { kind: "exchange", code: "EUR", amount: 100 } } as Partial<StoredTransaction>],
  ];
  it.each(kinds)("%s", (_name, o) => {
    render(<Harness initial={base([tx(o)])} />);
    expect(within(rowOf(o.description!)).queryByRole("button", AGAIN)).toBeNull();
    expect(within(rowOf(o.description!)).getByRole("button", { name: "Edit transaction" })).toBeTruthy();
  });
});
