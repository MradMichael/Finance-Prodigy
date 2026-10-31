// T1 and T2 (session 32 review; owner, session 33, DECISIONS_PENDING 13 (b), wording approved):
// - the entry form says, for Income, that the salary is already counted, and warns when an entry looks like it;
// - Setup chooses the balance the salary is paid into.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import InputPanel from "./InputPanel";
import SetupScreen from "./screens/SetupScreen";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type TrackedBalance } from "../lib/localData";

afterEach(cleanup);

const HINT = "Your monthly salary is already counted from Setup. Log only extra income here, like a bonus, a gift or freelance work.";
const WARNING = "This looks like your salary, which Setup already counts. Saving it as Income counts it twice.";
const NOTE = "On payday, ESSA adds your salary to this balance. It isn't counted as extra income.";

const cash: TrackedBalance = { id: "tb-cash", name: "Cash", paymentMethod: "cash", startingBalance: 200, startingDate: "2026-10-01", currency: "USD" };
const visa: TrackedBalance = { id: "tb-visa", name: "Visa •••• 4821", paymentMethod: "card", cardId: "c1", startingBalance: 500, startingDate: "2026-10-01", currency: "USD" };
const base = (over: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3200, trackedBalances: [cash, visa], ...over }) as LocalFinancials;

describe("T1: the entry form and the salary", () => {
  function panel() {
    const d = base();
    render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
  }
  const tile = (name: string) => screen.getAllByRole("button").find((b) => b.textContent?.trim().endsWith(name) && b.textContent.length < 20)!;

  it("the hint shows while the type is Income, and only then", () => {
    panel();
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.click(tile("Income"));
    expect(screen.getByText(HINT)).toBeTruthy();
    fireEvent.click(tile("Needs"));
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("the warning shows for an Income entry near Setup's income, not for a small one", () => {
    panel();
    fireEvent.click(tile("Income"));
    const amount = document.getElementById("tx-amount") as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "3150" } });
    expect(screen.getByText(WARNING)).toBeTruthy();
    fireEvent.change(amount, { target: { value: "500" } });
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});

describe("T2: Setup's 'Salary paid into'", () => {
  it("lists none and each tracked balance, shows the note, and stores the choice stamped as income", () => {
    const onChange = vi.fn();
    const d = base();
    render(<SetupScreen financials={d} dashData={computeDashboard(d)} onChange={onChange} />);
    const select = screen.getByLabelText("Salary paid into") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["—", "Cash", "Visa •••• 4821"]);
    expect(select.value).toBe("");
    expect(screen.getByText(NOTE)).toBeTruthy();
    fireEvent.change(select, { target: { value: "tb-visa" } });
    const saved = onChange.mock.calls.at(-1)![0] as LocalFinancials;
    expect(saved.salaryIntoBalanceId).toBe("tb-visa");
    expect(saved.settingsUpdatedAt?.income).toBeTruthy();
  });

  it("choosing '—' again clears it", () => {
    const onChange = vi.fn();
    const d = base({ salaryIntoBalanceId: "tb-visa" });
    render(<SetupScreen financials={d} dashData={computeDashboard(d)} onChange={onChange} />);
    const select = screen.getByLabelText("Salary paid into") as HTMLSelectElement;
    expect(select.value).toBe("tb-visa");
    fireEvent.change(select, { target: { value: "" } });
    expect((onChange.mock.calls.at(-1)![0] as LocalFinancials).salaryIntoBalanceId).toBeUndefined();
  });
});
