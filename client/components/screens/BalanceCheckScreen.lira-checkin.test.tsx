// T6, the smaller step (owner, session 35; label approved): a dollar Cash balance's check-in takes the lira you
// have beside the dollars. Counted = dollars + lira at today's rate; stored as today, one dollar figure. A lira
// balance or a card is unchanged.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type TrackedBalance } from "../../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 2, 12, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const LIRA = "Lira you have now (L£)";
const NOTE = "Added to the dollars at today's rate.";
const cash: TrackedBalance = { id: "cash", name: "Cash", paymentMethod: "cash", currency: "USD", startingBalance: 120, startingDate: "2026-11-01" };
const base = (trackedBalances: TrackedBalance[]) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, trackedBalances }) as LocalFinancials;
function show(data: LocalFinancials) {
  const onChange = vi.fn();
  render(<ThemeProvider><BalanceCheckScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} /></ThemeProvider>);
  return onChange;
}
const stored = (onChange: ReturnType<typeof vi.fn>) => (onChange.mock.calls.at(-1)![0] as LocalFinancials).trackedBalances!.find((t) => t.id === "cash")!.actualBalance;
const type = (placeholder: string, value: string) => fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

it("a dollar Cash balance shows the lira field and its note", () => {
  show(base([cash]));
  expect(screen.getByPlaceholderText(LIRA)).toBeTruthy();
  expect(screen.getByText(NOTE)).toBeTruthy();
});

it("a lira balance and a card don't", () => {
  show(base([
    { ...cash, id: "lbp", name: "Lira cash", currency: "LBP", startingBalance: 1_000_000 },
    { ...cash, id: "card", name: "Visa", paymentMethod: "card" },
  ]));
  expect(screen.queryByPlaceholderText(LIRA)).toBeNull();
  expect(screen.queryByText(NOTE)).toBeNull();
});

it("$100 and L£895,000 at 89,500 store $110", () => {
  const onChange = show(base([cash]));
  type("What you actually have now", "100");
  type(LIRA, "895000");
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(stored(onChange)).toBe(110);
});

it("lira alone stores its dollars; dollars alone as before", () => {
  let onChange = show(base([cash]));
  type(LIRA, "447500");
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(stored(onChange)).toBe(5);
  cleanup();
  onChange = show(base([cash]));
  type("What you actually have now", "97.25");
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(stored(onChange)).toBe(97.25);
});

it("to the cent: $20 and L£100,000 at 89,500 store $21.12", () => {
  const onChange = show(base([cash]));
  type("What you actually have now", "20");
  type(LIRA, "100000");
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(stored(onChange)).toBe(21.12);
});

it("both empty does nothing, and the lira field clears after Update", () => {
  const onChange = show(base([cash]));
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(onChange).not.toHaveBeenCalled();
  type(LIRA, "89500");
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(stored(onChange)).toBe(1);
  expect((screen.getByPlaceholderText(LIRA) as HTMLInputElement).value).toBe("");
});
