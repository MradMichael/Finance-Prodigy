// R7 (session 51 review; InputPanel split, step S2): the "is this lira amount really USD?" dialog was written
// out twice, in InputPanel (the entry form) and in EditTransactionSheet. These pin what each shows and does,
// before and after the two copies become one component. lbp-mistype-guard.test.tsx covers when it asks; this
// covers the dialog itself. Session 52 (owner): it behaves the same in both places.
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import InputPanel from "./InputPanel";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";

afterEach(cleanup);

const DIALOG = { name: "Confirm low LBP amount" };
const WORDS = "Double-check this amount400 LBP is unusually low for a real purchase — most things this cheap are actually meant to be USD. Did you mean to log this in USD instead?Let me fix the currencyNo, save it as 400 LBP";

let latest: LocalFinancials;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} onEdit={vi.fn()} onPay={vi.fn()} />;
}
function openOnEntryForm() {
  render(<Harness initial={{ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [], transactions: [] } as LocalFinancials} />);
  fireEvent.click(screen.getAllByRole("button").find((b) => b.getAttribute("aria-pressed") !== null && b.textContent?.includes("L£ LBP"))!);
  fireEvent.change(document.getElementById("tx-amount")!, { target: { value: "400" } });
  fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));
  return screen.getByRole("dialog", DIALOG);
}

const TX = { id: "t1", amount: 895_000, currency: "LBP", bucket: "WANTS", description: "Lunch", date: "2026-10-01", paymentMethod: "cash" } as StoredTransaction;
function openOnEditSheet() {
  const data = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, transactions: [TX] } as LocalFinancials;
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  const onClose = vi.fn();
  render(<ThemeProvider><EditTransactionSheet transaction={TX} financials={data} onChange={onChange} onClose={onClose} /></ThemeProvider>);
  const field = document.getElementById("edit-tx-amount") as HTMLInputElement;
  fireEvent.focus(field); fireEvent.change(field, { target: { value: "400" } }); fireEvent.blur(field);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  return { dialog: screen.getByRole("dialog", DIALOG), onChange, onClose };
}

describe("the same dialog in both places", () => {
  it("says the same words, with the same two answers", () => {
    expect(openOnEntryForm().textContent).toBe(WORDS);
    cleanup();
    expect(openOnEditSheet().dialog.textContent).toBe(WORDS);
  });

  it("takes focus when it opens, in both", () => {
    const onEntryForm = openOnEntryForm();
    expect(document.activeElement).toBe(onEntryForm);
    cleanup();
    const onEditSheet = openOnEditSheet().dialog;
    expect(document.activeElement).toBe(onEditSheet);
  });
});

describe("the entry form's dialog", () => {
  it("Escape closes it and stores nothing", () => {
    fireEvent.keyDown(openOnEntryForm(), { key: "Escape" });
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
    expect(latest.transactions).toHaveLength(0);
  });

  it("a tap outside closes it and stores nothing", () => {
    fireEvent.click(openOnEntryForm().parentElement!);
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
    expect(latest.transactions).toHaveLength(0);
  });
});

// Session 52 (owner, item 6): in the edit sheet the dialog sits inside the sheet's backdrop, whose click closes
// the sheet. A click in the dialog used to reach it, so "Let me fix the currency", or a tap outside the dialog,
// closed the sheet too and the edit in progress went. Now the dialog keeps its clicks, and Escape closes the
// dialog there as it does on the entry form, leaving the sheet (and what was typed) as it was.
describe("the edit sheet's dialog", () => {
  const typed = () => (document.getElementById("edit-tx-amount") as HTMLInputElement).value;

  it("'No, save it' saves once, and the sheet closes", () => {
    const { onChange, onClose } = openOnEditSheet();
    fireEvent.click(screen.getByRole("button", { name: /No, save it as 400 LBP/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
  });

  it("'Let me fix the currency' saves nothing and leaves the sheet open, with the amount as typed", () => {
    const { onChange, onClose } = openOnEditSheet();
    fireEvent.click(screen.getByRole("button", { name: "Let me fix the currency" }));
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(typed()).toBe("400");
  });

  it("Escape closes the dialog only: the sheet stays, nothing is saved", () => {
    const { dialog, onChange, onClose } = openOnEditSheet();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(typed()).toBe("400");
  });

  it("a second Escape, with the dialog gone, closes the sheet as before", () => {
    const { dialog, onClose } = openOnEditSheet();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a tap outside the dialog closes it and leaves the sheet open", () => {
    const { dialog, onChange, onClose } = openOnEditSheet();
    fireEvent.click(dialog.parentElement!);
    expect(screen.queryByRole("dialog", DIALOG)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cash, Card and Other say which is chosen (aria-pressed), not by colour alone", () => {
    const data = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, transactions: [TX] } as LocalFinancials;
    render(<ThemeProvider><EditTransactionSheet transaction={TX} financials={data} onChange={vi.fn()} onClose={vi.fn()} /></ThemeProvider>);
    const pressed = () => ["Cash", "Card", "Other"].map((n) => screen.getByRole("button", { name: new RegExp(n + "$") }).getAttribute("aria-pressed"));
    expect(pressed()).toEqual(["true", "false", "false"]);
    fireEvent.click(screen.getByRole("button", { name: /Other$/ }));
    expect(pressed()).toEqual(["false", "false", "true"]);
  });
});

describe("one copy", () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, f), "utf8");
  it("the dialog is written once, in LbpMistypeDialog, and both forms use it", () => {
    const MESSAGE = "is unusually low for a real purchase";
    expect(read("InputPanel.tsx")).not.toContain(MESSAGE);
    expect(read("EditTransactionSheet.tsx")).not.toContain(MESSAGE);
    expect(read("LbpMistypeDialog.tsx")).toContain(MESSAGE);
    expect(read("InputPanel.tsx")).toMatch(/<LbpMistypeDialog\b/);
    expect(read("EditTransactionSheet.tsx")).toMatch(/<LbpMistypeDialog\b/);
  });
});
