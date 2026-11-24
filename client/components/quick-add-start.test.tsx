// Session 62, item 1 (owner; TODO 117): "Add to Recurring" after a hand-logged payment made an item that started
// today, so the reminder asked "Netflix is due today ($9.99). Is it paid?" for the month already logged, and
// "Yes, it's paid" logged it again. Now the item starts one month after that payment: nothing is asked for this
// month. Both places the button appears: the edit sheet (the payment being edited) and the entry form (the payment
// being entered, logged right after).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import InputPanel from "./InputPanel";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-24T12:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const netflix = (id: string, date: string) =>
  ({ id, amount: 9.99, currency: "USD", bucket: "WANTS", category: "subscriptions", description: "Netflix", date, paymentMethod: "card", createdAt: `${date}T09:00:00.000Z` }) as StoredTransaction;
const start = (transactions: StoredTransaction[]) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [], transactions }) as LocalFinancials;

it("the edit sheet: Netflix logged by hand today, then made recurring: nothing is asked today; it starts on 24 Dec", () => {
  const today = netflix("n", "2026-11-24");
  const data = start([today, netflix("o", "2026-10-24")]);
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><EditTransactionSheet transaction={today} financials={data} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Add to Recurring" }));
  const saved = onChange.mock.calls.at(-1)![0];
  expect(saved.recurring).toHaveLength(1);
  expect(computeDashboard(saved).upcomingRenewals).toEqual([]);
  expect(saved.recurring[0].startDate).toBe("2026-12-24");
});

let latest: LocalFinancials;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} onEdit={vi.fn()} onPay={vi.fn()} />;
}

it("the entry form: Netflix typed today (logged in October), made recurring, then added: nothing is asked; it starts on 24 Dec", () => {
  render(<Harness initial={start([netflix("o", "2026-10-24")])} />);
  fireEvent.change(document.getElementById("tx-amount")!, { target: { value: "9.99" } });
  fireEvent.change(document.getElementById("tx-desc")!, { target: { value: "Netflix" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to Recurring" }));
  fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));
  expect(latest.transactions.filter((t) => t.description === "Netflix")).toHaveLength(2);
  expect(latest.recurring).toHaveLength(1);
  expect(computeDashboard(latest).upcomingRenewals).toEqual([]);
  expect(latest.recurring[0].startDate).toBe("2026-12-24");
});
