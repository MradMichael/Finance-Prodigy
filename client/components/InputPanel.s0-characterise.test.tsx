// InputPanel split, step S0 (docs/plans/phase-2.8.md; owner, session 52): tests only. These pin what My Finances
// does today in the places the split will move and nothing covered yet: adding and removing an asset, the
// transfer form's guard, adding a debt, adding and pausing a goal, and a History row. They change no behaviour;
// each move (S6-S11) must keep them green.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal, type StoredTransaction } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0), toFake: ["Date"] }); }); // 13 November 2026
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

let latest: LocalFinancials;
const onEdit = vi.fn();
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} onEdit={onEdit} onPay={vi.fn()} />;
}
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [], transactions: [], ...o }) as LocalFinancials;
const type = (id: string, v: string) => fireEvent.change(document.getElementById(id)!, { target: { value: v } });
/** DateFieldDMY's own calendar input, which takes a whole YYYY-MM-DD. */
const setDate = (id: string, iso: string) => fireEvent.change(document.getElementById(id)!.parentElement!.querySelector('input[type="date"]')!, { target: { value: iso } });
function manage(section: RegExp, initial = base()) {
  render(<Harness initial={initial} />);
  fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
  fireEvent.click(screen.getByRole("button", { name: section }));
}

describe("Other Assets", () => {
  it("adds an asset with its name, value and currency, and clears the form", () => {
    manage(/Other Assets/);
    const add = screen.getByRole("button", { name: "+ Add asset" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    type("new-asset-name", "  Car  ");
    type("new-asset-value", "12,500");
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(latest.assets).toHaveLength(1);
    expect(latest.assets[0]).toMatchObject({ name: "Car", value: 12500, currency: "USD" });
    expect(latest.assets[0].id).toBeTruthy();
    expect((document.getElementById("new-asset-name") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("$12,500")).toBeTruthy();
  });

  it("Remove asks first: declined keeps it; confirmed removes it and records the deletion", () => {
    const asset = { id: "a1", name: "Car", value: 12500, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" };
    manage(/Other Assets/, base({ assets: [asset] } as Partial<LocalFinancials>));
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(ask).toHaveBeenCalledWith("Remove this asset?");
    expect(latest.assets).toHaveLength(1);
    ask.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(latest.assets).toHaveLength(0);
    expect(JSON.stringify(latest.deletedKeys ?? {})).toContain("a1");
  });
});

describe("Transfer: the form's guard", () => {
  const SAME = /From and To are the same pool/;
  const side = (label: "From" | "To") => screen.getAllByText(label).find((el) => el.tagName === "P")!.parentElement!;
  const pick = (label: "From" | "To", method: RegExp) => fireEvent.click(within(side(label)).getByRole("button", { name: method }));
  const go = () => screen.getByRole("button", { name: /Transfer$/ }) as HTMLButtonElement;

  it("opens from Cash to Card: disabled until an amount is in and a card is picked", () => {
    manage(/^.*Transfer/);
    expect(go().disabled).toBe(true);
    type("new-transfer-amount", "50");
    expect(go().disabled).toBe(true); // To is Card, and no card is picked
    expect(screen.queryByText(SAME)).toBeNull();
  });

  it("Cash to Cash is the same pool: it says so and stays disabled", () => {
    manage(/^.*Transfer/);
    type("new-transfer-amount", "50");
    pick("To", /Cash$/);
    expect(screen.getByText(SAME)).toBeTruthy();
    expect(go().disabled).toBe(true);
    fireEvent.click(go());
    expect(latest.transactions).toHaveLength(0);
  });

  it("Cash to Other goes through: two linked rows, a toast, and the amount cleared", () => {
    manage(/^.*Transfer/);
    type("new-transfer-amount", "50");
    pick("To", /Other$/);
    expect(go().disabled).toBe(false);
    fireEvent.click(go());
    expect(latest.transactions).toHaveLength(2);
    expect(latest.transactions.every((t) => t.bucket === "TRANSFER")).toBe(true);
    expect(latest.transactions.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-50, 50]);
    expect(latest.transactions[0].linkedPaymentId).toBeTruthy();
    expect(latest.transactions[0].linkedPaymentId).toBe(latest.transactions[1].linkedPaymentId);
    expect(latest.transactions.map((t) => t.date)).toEqual(["2026-11-13", "2026-11-13"]);
    expect(screen.getByText("Transferred $50.00 from Cash to Other")).toBeTruthy();
    expect((document.getElementById("new-transfer-amount") as HTMLInputElement).value).toBe("");
  });
});

describe("Debts: adding one", () => {
  it("needs a name and a balance; stores them, with the balance as its opening balance", () => {
    manage(/Debts/);
    const add = screen.getByRole("button", { name: "+ Add debt" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    type("new-debt-name", "Car loan");
    expect(add.disabled).toBe(true);
    type("new-debt-balance", "5,000");
    type("new-debt-apr", "9.5");
    type("new-debt-min", "150");
    setDate("new-debt-opened", "2026-01-15");
    fireEvent.click(add);
    expect(latest.debts).toHaveLength(1);
    expect(latest.debts[0]).toMatchObject({ name: "Car loan", balance: 5000, openingBalance: 5000, apr: 9.5, minPayment: 150, currency: "USD", openedDate: "2026-01-15" });
    expect((document.getElementById("new-debt-name") as HTMLInputElement).value).toBe("");
  });

  it("a negative APR is stored as 0, and a blank minimum as 0", () => {
    manage(/Debts/);
    type("new-debt-name", "Loan from a friend");
    type("new-debt-balance", "800");
    type("new-debt-apr", "-3");
    fireEvent.click(screen.getByRole("button", { name: "+ Add debt" }));
    expect(latest.debts[0]).toMatchObject({ apr: 0, minPayment: 0 });
    expect(latest.debts[0].openedDate).toBeUndefined();
  });
});

describe("Goals: adding and pausing", () => {
  it("needs a name, a target and a date; what's already saved is its opening amount", () => {
    manage(/Goals/);
    const add = screen.getByRole("button", { name: "+ Add goal" }) as HTMLButtonElement;
    type("new-goal-name", "Laptop");
    type("new-goal-target", "1,200");
    expect(add.disabled).toBe(true);
    setDate("new-goal-date", "2027-03-01");
    type("new-goal-saved", "300");
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(latest.goals).toHaveLength(1);
    expect(latest.goals[0]).toMatchObject({ name: "Laptop", emoji: "🎯", targetAmount: 1200, currentAmount: 300, openingAmount: 300, currency: "USD", targetDate: "2027-03-01" });
    expect(latest.goals[0].pausedAt).toBeUndefined();
    expect((document.getElementById("new-goal-name") as HTMLInputElement).value).toBe("");
  });

  it("Pause stamps the goal and shows Paused; Resume clears it", () => {
    const goal: StoredGoal = { id: "g1", name: "Laptop", emoji: "L", targetAmount: 1200, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" };
    manage(/Goals/, base({ goals: [goal] }));
    fireEvent.click(screen.getByRole("button", { name: "Pause goal" }));
    expect(latest.goals[0].pausedAt).toBe(new Date().toISOString());
    expect(screen.getByText("Paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume goal" }));
    expect(latest.goals[0].pausedAt).toBeUndefined();
    expect(screen.queryByText("Paused")).toBeNull();
  });
});

describe("History: a past month's row", () => {
  const OCT: StoredTransaction = { id: "t-oct", amount: 42.5, currency: "USD", bucket: "WANTS", description: "Cinema night", date: "2026-10-18", paymentMethod: "cash", category: "entertainment", createdAt: "2026-10-18T20:00:00.000Z" } as StoredTransaction;

  function history() {
    render(<Harness initial={base({ transactions: [OCT] })} />);
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    return screen.getByText("Cinema night").closest("div.rounded-lg") as HTMLElement;
  }

  it("shows the description, its day and category, and the amount", () => {
    const row = history();
    expect(row.textContent).toContain("Cinema night");
    expect(row.textContent).toContain("18/10/2026");
    expect(row.textContent).toContain("$42.50");
  });

  it("Edit opens that entry; Delete asks, then soft-deletes it", () => {
    const row = history();
    fireEvent.click(within(row).getByRole("button", { name: "Edit transaction" }));
    expect(onEdit).toHaveBeenCalledWith("transaction", "t-oct");
    const ask = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(within(row).getByRole("button", { name: "Delete transaction" }));
    expect(ask).toHaveBeenCalledWith("Delete this transaction?");
    expect(latest.transactions).toHaveLength(1);
    expect(latest.transactions[0].deletedAt).toBeTruthy();
    expect(screen.queryByText("Cinema night")).toBeNull();
  });
});
