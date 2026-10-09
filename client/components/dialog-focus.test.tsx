// A11Y-02, for the four overlays that already declare themselves modal
// dialogs (role="dialog", aria-modal): focus stayed on the page behind them.
// The blocking backup prompt was 21 Tab presses in, past the sidebar, and the
// two dialogs that close on Escape never heard it, because their key handler
// sits on the overlay and focus wasn't there. Now each takes focus when it
// opens (the dialog itself, announced by its name, so nothing in it is
// pressed by a stray Enter), keeps Tab inside, and gives focus back when it
// closes. The nine overlays with no dialog role are left for the owner.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SyncChoicePrompt from "./SyncChoicePrompt";
import ImportStatement from "./ImportStatement";
import EditTransactionSheet from "./EditTransactionSheet";
import InputPanel from "./InputPanel";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";

afterEach(cleanup);

const data = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: shift });

describe("the blocking backup prompt", () => {
  function show() {
    const view = render(<ThemeProvider><button>Overview</button><SyncChoicePrompt hasServerCopy busy={false} onChoose={vi.fn()} /></ThemeProvider>);
    const dialog = screen.getByRole("dialog");
    const choices = Array.from(dialog.querySelectorAll("button"));
    return { view, dialog, choices };
  }

  it("takes focus when it opens: the dialog itself, not a choice", () => {
    const { dialog } = show();
    expect(document.activeElement).toBe(dialog);
  });

  it("keeps Tab inside: past the last choice is the first, before the first is the last", () => {
    const { dialog, choices } = show();
    const first = choices[0], last = choices[choices.length - 1];
    tab(true); // from the dialog itself, backwards
    expect(document.activeElement).toBe(last);
    tab();
    expect(document.activeElement).toBe(first);
    tab(true);
    expect(document.activeElement).toBe(last);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("focus that lands behind it comes back in on Tab", () => {
    const { choices } = show();
    screen.getByRole("button", { name: "Overview", hidden: true }).focus();
    tab();
    expect(document.activeElement).toBe(choices[0]);
  });

  it("gives focus back to where it was when it closes", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Behind";
    document.body.appendChild(trigger);
    trigger.focus();
    const { view } = show();
    expect(document.activeElement).not.toBe(trigger);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe("Import statement", () => {
  it("takes focus, so Escape now closes it", () => {
    const onClose = vi.fn();
    render(<ThemeProvider><ImportStatement financials={data} onImport={vi.fn()} onClose={onClose} /></ThemeProvider>);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the low-lira confirm", () => {
  it("in Edit transaction: takes focus when it opens, and gives it back to Save when it closes", () => {
    const tx = { id: "t1", amount: 300, currency: "LBP", bucket: "WANTS", description: "Gum", date: "2026-10-03" } as StoredTransaction;
    render(<ThemeProvider><EditTransactionSheet transaction={tx} financials={{ ...data, transactions: [tx] }} onChange={vi.fn()} onClose={vi.fn()} /></ThemeProvider>);
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.click(save);
    const dialog = screen.getByRole("dialog", { name: "Confirm low LBP amount" });
    expect(document.activeElement).toBe(dialog);
    const buttons = Array.from(dialog.querySelectorAll("button"));
    fireEvent.click(buttons[0]); // the first choice closes it
    expect(screen.queryByRole("dialog", { name: "Confirm low LBP amount" })).toBeNull();
    expect(document.activeElement).toBe(save);
  });

  it("in My Finances: takes focus, so Escape now closes it", () => {
    render(<ThemeProvider><InputPanel financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} /></ThemeProvider>);
    fireEvent.change(document.getElementById("tx-desc")!, { target: { value: "Gum" } });
    fireEvent.change(document.getElementById("tx-amount")!, { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "L£ LBP" }));
    fireEvent.keyDown(document.getElementById("tx-desc")!, { key: "Enter" });
    const dialog = screen.getByRole("dialog", { name: "Confirm low LBP amount" });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Confirm low LBP amount" })).toBeNull();
  });
});
