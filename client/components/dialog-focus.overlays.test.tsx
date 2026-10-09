// A11Y-02, the rest: eight full-screen overlays declared nothing at all, no
// dialog role, no name, and left focus on the page behind them. Each is now a
// modal dialog named by the title it already shows, takes focus when it
// opens (the dialog itself), keeps Tab inside, and gives focus back when it
// closes (useDialogFocus, as the first four). No wording changes, and no new
// way to close any of them: Escape is not added (a sheet would discard what
// was typed; the recovery code is a required step).
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import EditDebtSheet from "./EditDebtSheet";
import EditGoalSheet from "./EditGoalSheet";
import EditRecurringSheet from "./EditRecurringSheet";
import PayDebtSheet from "./PayDebtSheet";
import EditTransactionSheet from "./EditTransactionSheet";
import CloseCycleModal from "./CloseCycleModal";
import RecoveryCodeModal from "./RecoveryCodeModal";
import RecurringModelNoticeModal from "./RecurringModelNoticeModal";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredDebt, type StoredGoal, type StoredRecurring, type StoredTransaction } from "../lib/localData";

afterEach(cleanup);

const DEBT = { id: "d1", name: "Car loan", openingBalance: 5000, balance: 5000, apr: 9, minPayment: 150, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const GOAL = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" } as StoredGoal;
const REC = { id: "r1", name: "Uni", emoji: "U", amount: 750, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-06-01", createdAt: "2026-06-01T00:00:00.000Z" } as StoredRecurring;
const TX = { id: "t1", amount: 46.8, currency: "USD", bucket: "WANTS", description: "Bistro", date: "2026-10-03" } as StoredTransaction;
const data = { ...DEFAULT_DATA, income: 3000, debts: [DEBT], goals: [GOAL], recurring: [REC], transactions: [TX] } as LocalFinancials;
const sheet = { financials: data, onChange: vi.fn(), onClose: vi.fn() };

const OVERLAYS: [string, ReactElement][] = [
  ["Edit debt", <EditDebtSheet key="a" debt={DEBT} {...sheet} />],
  ["Edit goal", <EditGoalSheet key="b" goal={GOAL} {...sheet} />],
  ["Edit recurring", <EditRecurringSheet key="c" recurring={REC} {...sheet} />],
  ["Record a payment", <PayDebtSheet key="d" debt={DEBT} {...sheet} />],
  ["Edit entry", <EditTransactionSheet key="e" transaction={TX} {...sheet} />],
  ["Close this cycle", <CloseCycleModal key="f" cycleLabel="September 2026" rows={[]} adjustmentRows={[]} daysLate={0} rangeEnd="30/09/2026" reopenable lbpRateAtClose={89500} onCancel={vi.fn()} onConfirm={vi.fn()} />],
  ["Save your recovery code", <RecoveryCodeModal key="g" code="ABCD-EFGH-IJKL" onContinue={vi.fn()} />],
  ["Recurring bills, updated", <RecurringModelNoticeModal key="h" outstandingCount={2} onDismiss={vi.fn()} />],
];

it.each(OVERLAYS)("%s: a modal dialog named by its own title, which takes focus and gives it back", (name, el) => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  const view = render(<ThemeProvider>{el}</ThemeProvider>);
  const dialog = screen.getByRole("dialog", { name });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(document.activeElement).toBe(dialog);
  view.unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

it("a dialog opened over another one has Tab to itself: Edit entry's low-lira confirm", () => {
  const lira = { ...TX, currency: "LBP", amount: 300 } as StoredTransaction;
  render(<ThemeProvider><EditTransactionSheet transaction={lira} {...sheet} financials={{ ...data, transactions: [lira] }} /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const confirm = screen.getByRole("dialog", { name: "Confirm low LBP amount" });
  expect(document.activeElement).toBe(confirm);
  const [first, second] = Array.from(confirm.querySelectorAll("button"));
  first.focus();
  // Mid-dialog, Tab is the browser's to move: nothing may cancel it (the sheet underneath used to).
  expect(fireEvent.keyDown(first, { key: "Tab" })).toBe(true);
  second.focus();
  fireEvent.keyDown(second, { key: "Tab" });
  expect(document.activeElement).toBe(first); // wraps within the confirm, not out to the sheet
});

it("once the dialog on top closes, the one underneath has Tab again", () => {
  const lira = { ...TX, currency: "LBP", amount: 300 } as StoredTransaction;
  render(<ThemeProvider><EditTransactionSheet transaction={lira} {...sheet} financials={{ ...data, transactions: [lira] }} /></ThemeProvider>);
  const sheetDialog = screen.getByRole("dialog", { name: "Edit entry" });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const confirm = screen.getByRole("dialog", { name: "Confirm low LBP amount" });
  fireEvent.click(confirm.querySelectorAll("button")[0]); // closes the confirm only
  expect(screen.queryByRole("dialog", { name: "Confirm low LBP amount" })).toBeNull();
  const stops = Array.from(sheetDialog.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]"))
    .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest("[aria-hidden='true']"));
  stops[stops.length - 1].focus();
  fireEvent.keyDown(stops[stops.length - 1], { key: "Tab" });
  expect(document.activeElement).toBe(stops[0]);
});
