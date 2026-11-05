// The "is this lira amount really USD?" check (session 42, owner-approved
// item 2). It lived as the same inline `currency === "LBP" && amount < 500`
// in two places (InputPanel's addTransaction, EditTransactionSheet's save),
// with no test on either path. These pin both paths' behaviour before and
// after the check moves into one function, lib/entryGuards.ts. Phase 9-N
// will make that one function currency-relative; until then the threshold
// is exactly 500 LBP, and must not move for current users.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import InputPanel from "./InputPanel";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";
import { looksLikeMistypedLbp, LBP_MISTYPE_THRESHOLD } from "../lib/entryGuards";

afterEach(cleanup);

const DIALOG = { name: "Confirm low LBP amount" };

describe("looksLikeMistypedLbp", () => {
  it("is 500 LBP exactly: 499 asks, 500 doesn't", () => {
    expect(LBP_MISTYPE_THRESHOLD).toBe(500);
    expect(looksLikeMistypedLbp(499, "LBP")).toBe(true);
    expect(looksLikeMistypedLbp(499.99, "LBP")).toBe(true);
    expect(looksLikeMistypedLbp(500, "LBP")).toBe(false);
    expect(looksLikeMistypedLbp(895_000, "LBP")).toBe(false);
  });
  it("never asks about a USD amount", () => {
    expect(looksLikeMistypedLbp(10, "USD")).toBe(false);
    expect(looksLikeMistypedLbp(499, "USD")).toBe(false);
  });
});

let latest: LocalFinancials;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} onEdit={vi.fn()} onPay={vi.fn()} />;
}
const start = () => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [], transactions: [] }) as LocalFinancials;
const toggle = (text: string) => fireEvent.click(screen.getAllByRole("button").find((b) => b.getAttribute("aria-pressed") !== null && b.textContent?.includes(text))!);
const amount = (v: string) => fireEvent.change(document.getElementById("tx-amount")!, { target: { value: v } });
const add = () => fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));

describe("the main entry form", () => {
  it("L£400 asks first and stores nothing until answered; 'No, save it' stores it as lira", () => {
    render(<Harness initial={start()} />);
    toggle("L£ LBP");
    amount("400");
    add();
    expect(screen.getByRole("dialog", DIALOG)).toBeTruthy();
    expect(latest.transactions).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /No, save it as 400 LBP/ }));
    expect(latest.transactions).toHaveLength(1);
    expect(latest.transactions[0]).toMatchObject({ amount: 400, currency: "LBP" });
  });

  it("'Let me fix the currency' stores nothing", () => {
    render(<Harness initial={start()} />);
    toggle("L£ LBP");
    amount("400");
    add();
    fireEvent.click(screen.getByRole("button", { name: "Let me fix the currency" }));
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
    expect(latest.transactions).toHaveLength(0);
  });

  it("L£500 and $400 are stored without asking", () => {
    render(<Harness initial={start()} />);
    toggle("L£ LBP");
    amount("500");
    add();
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
    expect(latest.transactions).toHaveLength(1);
    toggle("$ USD");
    amount("400");
    add();
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
    expect(latest.transactions).toHaveLength(2);
  });
});

describe("the edit sheet", () => {
  const TX = { id: "t1", amount: 895_000, currency: "LBP", bucket: "WANTS", description: "Lunch", date: "2026-10-01", paymentMethod: "cash" } as StoredTransaction;
  function open() {
    const data = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, transactions: [TX] } as LocalFinancials;
    const onChange = vi.fn<(d: LocalFinancials) => void>();
    render(<ThemeProvider><EditTransactionSheet transaction={TX} financials={data} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
    const field = document.getElementById("edit-tx-amount") as HTMLInputElement;
    const setAmount = (v: string) => { fireEvent.focus(field); fireEvent.change(field, { target: { value: v } }); fireEvent.blur(field); };
    return { onChange, setAmount };
  }

  it("saving L£400 asks first", () => {
    const { onChange, setAmount } = open();
    setAmount("400");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog", DIALOG)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("saving L£500 doesn't ask", () => {
    const { onChange, setAmount } = open();
    setAmount("500");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// Session 42 (owner, item 2, answer 8): the split entry's lira leg skipped the
// check. Not intentional; it now asks like the single-currency entry does.
describe("the split entry's lira leg", () => {
  const split = (usd: string, lbp: string) => {
    fireEvent.click(screen.getByRole("button", { name: /Split across USD and LBP\?/ }));
    fireEvent.change(document.getElementById("tx-split-usd")!, { target: { value: usd } });
    fireEvent.change(document.getElementById("tx-split-lbp")!, { target: { value: lbp } });
    add();
  };

  it("$10 + L£400 asks first and stores neither leg until answered; 'No, save it' stores both", () => {
    render(<Harness initial={start()} />);
    split("10", "400");
    expect(screen.getByRole("dialog", DIALOG)).toBeTruthy();
    expect(latest.transactions).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /No, save it as 400 LBP/ }));
    expect(latest.transactions).toHaveLength(2);
    expect(latest.transactions.map((t) => [t.amount, t.currency]).sort()).toEqual([[10, "USD"], [400, "LBP"]]);
    expect(latest.transactions[0].linkedPaymentId).toBe(latest.transactions[1].linkedPaymentId);
  });

  it("'Let me fix the currency' stores neither leg and keeps the split form", () => {
    render(<Harness initial={start()} />);
    split("10", "400");
    fireEvent.click(screen.getByRole("button", { name: "Let me fix the currency" }));
    expect(latest.transactions).toHaveLength(0);
    expect(document.getElementById("tx-split-lbp")).toBeTruthy();
  });

  it("$10 + L£500 is stored without asking", () => {
    render(<Harness initial={start()} />);
    split("10", "500");
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
    expect(latest.transactions).toHaveLength(2);
  });
});
