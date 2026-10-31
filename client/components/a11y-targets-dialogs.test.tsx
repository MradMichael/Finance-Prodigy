// Session 32 review, batch 4 (no text changes):
// - U8: Escape closed only the statement import. The four edit sheets, Record a payment and Close this
//   cycle now close on it, through the same close their ✕ and Cancel run; the prompts that need a choice
//   still don't.
// - A3: My Finances' Daily and Manage buttons didn't say which was selected.
// - A2: the Profile palette subtitles (3.6-3.9:1) and Debts' "pay" (3.5:1) were dimmed below 4.5:1.
// - A1: every control at least 24 x 24 px (WCAG 2.2 SC 2.5.8), set once in globals.css; measured live.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import fs from "fs";
import path from "path";
import EditDebtSheet from "./EditDebtSheet";
import EditGoalSheet from "./EditGoalSheet";
import EditRecurringSheet from "./EditRecurringSheet";
import PayDebtSheet from "./PayDebtSheet";
import EditTransactionSheet from "./EditTransactionSheet";
import CloseCycleModal from "./CloseCycleModal";
import RecoveryCodeModal from "./RecoveryCodeModal";
import RecurringModelNoticeModal from "./RecurringModelNoticeModal";
import SyncChoicePrompt from "./SyncChoicePrompt";
import InputPanel from "./InputPanel";
import DebtsScreen from "./screens/DebtsScreen";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredDebt, type StoredGoal, type StoredRecurring, type StoredTransaction } from "../lib/localData";

afterEach(cleanup);

const DEBT = { id: "d1", name: "Car loan", openingBalance: 5000, balance: 5000, apr: 9, minPayment: 150, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredDebt;
const GOAL = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" } as StoredGoal;
const REC = { id: "r1", name: "Uni", emoji: "U", amount: 750, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-06-01", createdAt: "2026-06-01T00:00:00.000Z" } as StoredRecurring;
const TX = { id: "t1", amount: 46.8, currency: "USD", bucket: "WANTS", description: "Bistro", date: "2026-10-03" } as StoredTransaction;
const data = { ...DEFAULT_DATA, income: 3000, debts: [DEBT], goals: [GOAL], recurring: [REC], transactions: [TX] } as LocalFinancials;
const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

describe("U8: Escape closes the sheets and the close dialog", () => {
  const cases: [string, (close: () => void, onChange: () => void) => ReactElement][] = [
    ["Edit debt", (close, onChange) => <EditDebtSheet debt={DEBT} financials={data} onChange={onChange} onClose={close} />],
    ["Edit goal", (close, onChange) => <EditGoalSheet goal={GOAL} financials={data} onChange={onChange} onClose={close} />],
    ["Edit recurring", (close, onChange) => <EditRecurringSheet recurring={REC} financials={data} onChange={onChange} onClose={close} />],
    ["Record a payment", (close, onChange) => <PayDebtSheet debt={DEBT} financials={data} onChange={onChange} onClose={close} />],
    ["Edit entry", (close, onChange) => <EditTransactionSheet transaction={TX} financials={data} onChange={onChange} onClose={close} />],
    ["Close this cycle", (close, onConfirm) => <CloseCycleModal cycleLabel="September 2026" rows={[]} adjustmentRows={[]} daysLate={0} rangeEnd="30/09/2026" reopenable lbpRateAtClose={89500} onCancel={close} onConfirm={onConfirm} />],
  ];
  it.each(cases)("%s", (name, el) => {
    const close = vi.fn();
    const onChange = vi.fn();
    render(<ThemeProvider>{el(close, onChange)}</ThemeProvider>);
    expect(screen.getByRole("dialog", { name })).toBeTruthy();
    escape();
    expect(close).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the prompts that need a choice stay open", () => {
    const onContinue = vi.fn(), onDismiss = vi.fn(), onChoose = vi.fn();
    render(<ThemeProvider><RecoveryCodeModal code="ABCD-EFGH-IJKL" onContinue={onContinue} /></ThemeProvider>);
    escape(); cleanup();
    render(<ThemeProvider><RecurringModelNoticeModal outstandingCount={2} onDismiss={onDismiss} /></ThemeProvider>);
    escape(); cleanup();
    render(<ThemeProvider><SyncChoicePrompt hasServerCopy busy={false} onChoose={onChoose} /></ThemeProvider>);
    escape();
    expect(onContinue).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe("A3: My Finances' tabs say which one is selected", () => {
  it("Daily is pressed at first, Manage once chosen", () => {
    render(<InputPanel financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
    const daily = screen.getByRole("button", { name: /Daily/ });
    const manage = screen.getByRole("button", { name: /Manage/ });
    expect(daily.getAttribute("aria-pressed")).toBe("true");
    expect(manage.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(manage);
    expect(daily.getAttribute("aria-pressed")).toBe("false");
    expect(manage.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("A2: no text dimmed below 4.5:1 in the two places axe found", () => {
  it("Debts' pay button isn't dimmed at rest", () => {
    render(<DebtsScreen financials={data} dashData={computeDashboard(data)} onEdit={vi.fn()} onPay={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Record a payment" }).className).not.toMatch(/(^| )opacity-\d+/);
  });

  it("the Profile palette subtitles aren't dimmed", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/profile/page.tsx"), "utf8");
    const line = src.split("\n").find((l) => l.includes("{meta.desc}"));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/opacity-\d+/);
  });
});

describe("A1: a 24 px minimum for every control, set once", () => {
  it("globals.css sets min-height on buttons and fields, and min-width on buttons, leaving range, checkbox and radio alone", () => {
    const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const heights = css.match(/([^{}]+)\{\s*min-height:\s*24px;\s*\}/);
    const widths = css.match(/([^{}]+)\{\s*min-width:\s*24px;\s*\}/);
    expect(heights).not.toBeNull();
    expect(widths).not.toBeNull();
    for (const sel of ["button", '[role="button"]', "select", 'input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"])']) expect(heights![1]).toContain(sel);
    for (const sel of ["button", '[role="button"]']) expect(widths![1]).toContain(sel);
  });
});
