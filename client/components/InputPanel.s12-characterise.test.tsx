// InputPanel split (session 55): three things the moved code does that no test pinned (found by perturbing
// the moved files: each of these could be broken with every test still green). Characterisation only: they pass
// on the code before the moves and after.
// - a category rule fills the category when an entry is saved without one;
// - a split entry (dollars and lira at once) is remembered like a single one (U5);
// - History groups past entries by the account's cycle, not the calendar month.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";
import type { Session } from "../lib/auth";

const session: Session = { userId: "u1", email: "quartz@example.invalid", name: "Quartz Nine" };
let latest: LocalFinancials;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} session={session} onEdit={vi.fn()} onPay={vi.fn()} />;
}
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [], transactions: [], ...o }) as LocalFinancials;
const type = (id: string, v: string) => fireEvent.change(document.getElementById(id)!, { target: { value: v } });
const add = () => fireEvent.click(screen.getByRole("button", { name: "+ Add entry" }));

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

describe("a category rule fills the category on save", () => {
  const rules = { categoryRules: [{ id: "r1", keyword: "Charcoal", category: "dining" }] };

  it("an entry saved with no category takes the rule's", () => {
    render(<Harness initial={base(rules)} />);
    type("tx-amount", "12.4");
    type("tx-desc", "Charcoal Grill");
    add();
    expect(latest.transactions[0]).toMatchObject({ description: "Charcoal Grill", category: "dining" });
  });

  it("a category picked by hand is kept: the rule never overrides it", () => {
    render(<Harness initial={base(rules)} />);
    type("tx-amount", "12.4");
    type("tx-desc", "Charcoal Grill");
    fireEvent.change(document.getElementById("tx-category")!, { target: { value: "groceries" } });
    add();
    expect(latest.transactions[0].category).toBe("groceries");
  });

  it("with no matching rule, no category is stored", () => {
    render(<Harness initial={base(rules)} />);
    type("tx-amount", "12.4");
    type("tx-desc", "Bookshop");
    add();
    expect(latest.transactions[0].category).toBeUndefined();
  });
});

describe("a split entry is remembered on this device (U5)", () => {
  it("stores its two parts and remembers the method", () => {
    render(<Harness initial={base()} />);
    fireEvent.click(screen.getByRole("button", { name: "Split across USD and LBP?" }));
    type("tx-split-usd", "10");
    type("tx-split-lbp", "200,000");
    type("tx-desc", "Dinner");
    add();
    expect(latest.transactions).toHaveLength(2);
    expect(latest.transactions.map((t) => t.currency).sort()).toEqual(["LBP", "USD"]);
    const kept = JSON.parse(localStorage.getItem("essa_entry_last_u1") ?? "null");
    expect(kept).not.toBeNull();
    expect(kept.paymentMethod).toBe(latest.transactions[0].paymentMethod);
    expect(typeof kept.currency).toBe("string");
  });
});

describe("History groups by the account's cycle", () => {
  const tx = (o: Partial<StoredTransaction>): StoredTransaction => ({ id: "t", amount: 20, currency: "USD", bucket: "WANTS", description: "x", date: "2026-11-01", paymentMethod: "cash", createdAt: "2026-11-01T09:00:00.000Z", updatedAt: "2026-11-01T09:00:00.000Z", ...o }) as StoredTransaction;

  it("with a cycle starting on the 15th, the 10th and the 20th of one month sit in different groups", () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 20, 12, 0), toFake: ["Date"] }); // 20 November 2026: the cycle is 15 Nov to 14 Dec
    const d = base({ cycleStartDay: 15, transactions: [
      tx({ id: "a", description: "Early October", date: "2026-10-10" }), // the cycle of 15 Sep to 14 Oct
      tx({ id: "b", description: "Late October", date: "2026-10-20" }), // the cycle of 15 Oct to 14 Nov
      tx({ id: "c", description: "Early November", date: "2026-11-10" }), // the same cycle as Late October
    ] } as Partial<LocalFinancials>);
    render(<Harness initial={d} />);
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    const group = (text: string) => screen.getByText(text).closest("[data-entry-row]")!.parentElement!.parentElement!;
    expect(group("Late October")).toBe(group("Early November"));
    expect(group("Early October")).not.toBe(group("Late October"));
    expect(within(group("Late October") as HTMLElement).queryByText("Early October")).toBeNull();
  });
});
