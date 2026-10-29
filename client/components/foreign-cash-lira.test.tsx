// CUR-06 (owner, session 30, DECISIONS_PENDING entry 8 (a)): dollars changed
// into lira cash are recorded through the exchange form, with lira as the
// currency received. Not as an exchange is (a Wants/Travel row, the euros on
// a sheet): lira is a ledger currency and the money stays the person's, so
// it's a two-currency transfer: out of the paying pool in dollars, into the
// receiving pool in lira, linked as a transfer's legs are. Not spending. The
// form's new words are drafts, HELD.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ExchangeForm } from "./ForeignCashForms";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { buildLiraExchange, buildExchange } from "../lib/foreignCash";
import { isReimbursement } from "../lib/trips";
import { DEFAULT_DATA, type LocalFinancials, type StoredCard, type TrackedBalance } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 14, 12, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const CARD: StoredCard = { id: "c-neo", type: "Other", last4: "4242", label: "NEO USD" };
const CARD_POOL: TrackedBalance = { id: "tb-card", name: "NEO USD", paymentMethod: "card", cardId: "c-neo", startingBalance: 500, startingDate: "2026-10-01", currency: "USD" };
const CASH_POOL: TrackedBalance = { id: "tb-cash", name: "Lira cash", paymentMethod: "cash", startingBalance: 1_000_000, startingDate: "2026-10-01", currency: "LBP" };
const D = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [CARD], ...o }) as LocalFinancials;
const change = () => buildLiraExchange({ date: "2026-10-05", paid: 100, from: { paymentMethod: "card", cardId: "c-neo", cardLabel: "NEO USD" }, received: 8_900_000, to: { paymentMethod: "cash" } }, 89_500);

describe("CUR-06: the two rows", () => {
  it("out of the card in dollars, into cash in lira, both transfers, linked", () => {
    const [out, inn] = change();
    expect(out).toMatchObject({ amount: -100, currency: "USD", bucket: "TRANSFER", paymentMethod: "card", cardId: "c-neo", date: "2026-10-05", description: "Exchange to LBP" });
    expect(inn).toMatchObject({ amount: 8_900_000, currency: "LBP", bucket: "TRANSFER", paymentMethod: "cash", date: "2026-10-05", description: "Exchange from USD" });
    expect(out.linkedPaymentId).toBeTruthy();
    expect(inn.linkedPaymentId).toBe(out.linkedPaymentId);
    expect(out.fx).toBeUndefined();
    expect(inn.fx).toBeUndefined();
  });

  it("CUR-06's example: the card pool loses exactly $100, the lira cash pool gains exactly L£8,900,000", () => {
    const d = computeDashboard(D({ trackedBalances: [CARD_POOL, CASH_POOL], transactions: change() }));
    expect(d.balanceChecks.find((b) => b.id === "tb-card")!.nowNative).toBe(400);
    expect(d.balanceChecks.find((b) => b.id === "tb-cash")!.nowNative).toBe(9_900_000);
  });

  it("not spending: this month's spend and budget are untouched, and the incoming row isn't a reimbursement", () => {
    const rows = change();
    const before = computeDashboard(D());
    const after = computeDashboard(D({ transactions: rows }));
    expect(after.month.totalSpend).toBe(before.month.totalSpend);
    expect(isReimbursement(rows[1], rows)).toBe(false);
  });
});

describe("CUR-06: the exchange form with lira received", () => {
  const show = (d = D()) => {
    const onChange = vi.fn<(u: LocalFinancials) => void>();
    render(<ThemeProvider><ExchangeForm financials={d} onChange={onChange} onDone={vi.fn()} /></ThemeProvider>);
    return onChange;
  };
  const type = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } });

  it("asks where the lira went; no trip, no spending line; says it moves the money, not spending", () => {
    show(D({ trips: [{ id: "t1", name: "Rome", startDate: "2026-10-01", endDate: "2026-10-30", budgetUSD: 900, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" }] }));
    type("fx-ex-code", "LBP"); type("fx-ex-paid", "100"); type("fx-ex-received", "8900000");
    expect(screen.getByText("Received into")).toBeTruthy();
    expect(screen.queryByLabelText("Trip")).toBeNull();
    expect(screen.queryByText(/Counts as Travel spending/)).toBeNull();
    expect(screen.getByText("Moves $100.00 into lira cash. Not counted as spending.")).toBeTruthy();
  });

  it("saves the two rows: out of the paying pool, into cash by default", () => {
    const onChange = show();
    type("fx-ex-code", "LBP"); type("fx-ex-paid", "100"); type("fx-ex-received", "8900000");
    fireEvent.click(screen.getByRole("button", { name: "Save exchange" }));
    const rows = onChange.mock.calls[0][0].transactions;
    expect(rows).toHaveLength(2);
    expect(rows.map((t) => [t.amount, t.currency, t.bucket, t.paymentMethod])).toEqual([[-100, "USD", "TRANSFER", "cash"], [8_900_000, "LBP", "TRANSFER", "cash"]]);
  });

  it("another code behaves as before: one Wants/Travel row naming the euros", () => {
    const onChange = show();
    type("fx-ex-code", "EUR"); type("fx-ex-paid", "100"); type("fx-ex-received", "92");
    expect(screen.getByText(/Counts as Travel spending of \$100\.00\./)).toBeTruthy();
    expect(screen.queryByText("Received into")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save exchange" }));
    const rows = onChange.mock.calls[0][0].transactions;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bucket: "WANTS", fx: { code: "EUR", amount: 92, kind: "exchange" } });
  });

  it("USD stays refused, with the code sentence naming lira", () => {
    show();
    type("fx-ex-code", "USD"); type("fx-ex-paid", "100"); type("fx-ex-received", "100");
    fireEvent.click(screen.getByRole("button", { name: "Save exchange" }));
    expect(within(screen.getByRole("status")).getByText("Use a three-letter currency code other than USD, like EUR, or LBP for lira.")).toBeTruthy();
  });

  it("the exchange row itself is unchanged by any of this (buildExchange)", () => {
    expect(buildExchange({ date: "2026-10-05", paid: 100, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 92, description: "Exchange to EUR" }, 89_500)).toMatchObject({ bucket: "WANTS", amount: 100 });
  });
});
