// D-a (owner, session 56): the edit sheet follows the entry form. The form refuses an amount of 0 (its Add button
// is disabled) and fills a blank description with the type's name; the sheet accepted 0 and, with the description
// emptied, Save did nothing and said nothing. Now the sheet refuses 0 the same way and a blank description takes
// the type being saved. A row stored at 0 on purpose (a debt, safety net or goal correction) keeps saving: the
// sheet edits those too, and refusing their 0 would lock them.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditTransactionSheet from "./EditTransactionSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction, type TxBucket } from "../lib/localData";
import { entryDescription } from "../lib/entryGuards";

afterEach(cleanup);

const row = (over: Partial<StoredTransaction> = {}) =>
  ({ id: "t1", amount: 12, currency: "USD", bucket: "NEEDS", description: "Bread", date: "2026-10-01", paymentMethod: "cash", ...over }) as StoredTransaction;

function open(tx: StoredTransaction) {
  const data = { ...DEFAULT_DATA, income: 3000, transactions: [tx] } as LocalFinancials;
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><EditTransactionSheet transaction={tx} financials={data} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  const amount = screen.getByLabelText("Amount", { exact: true }) as HTMLInputElement;
  const desc = screen.getByLabelText("Description", { exact: true }) as HTMLInputElement;
  const saved = () => onChange.mock.calls.at(-1)?.[0].transactions.find((t) => t.id === tx.id);
  return { save, amount, desc, saved, onChange };
}

describe("an amount of 0", () => {
  it("a $12 entry set to 0: Save is disabled and nothing is saved, as the form's Add button", () => {
    const s = open(row());
    expect(s.save.disabled).toBe(false);
    fireEvent.change(s.amount, { target: { value: "0" } });
    expect(s.save.disabled).toBe(true);
    fireEvent.click(s.save);
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it("an emptied amount: Save is disabled too", () => {
    const s = open(row());
    fireEvent.change(s.amount, { target: { value: "" } });
    expect(s.save.disabled).toBe(true);
  });

  it("back above 0, Save works again and stores the new amount", () => {
    const s = open(row());
    fireEvent.change(s.amount, { target: { value: "0" } });
    fireEvent.change(s.amount, { target: { value: "15" } });
    expect(s.save.disabled).toBe(false);
    fireEvent.click(s.save);
    expect(s.saved()?.amount).toBe(15);
  });

  it("a correction row stored at 0 (safety net) still saves, its 0 kept", () => {
    const s = open(row({ amount: 0, bucket: "SAVINGS", description: "Emergency fund balance correction", efAmount: 250 }));
    expect(s.save.disabled).toBe(false);
    fireEvent.change(s.desc, { target: { value: "Emergency fund balance correction (bank)" } });
    fireEvent.click(s.save);
    expect(s.saved()?.amount).toBe(0);
    expect(s.saved()?.description).toBe("Emergency fund balance correction (bank)");
  });

  it("a goal correction stored at 0 still saves", () => {
    const s = open(row({ amount: 0, bucket: "SAVINGS", description: "Goal balance correction: Car", goalId: "g1", goalAmount: 100 }));
    fireEvent.click(s.save);
    expect(s.saved()?.amount).toBe(0);
  });
});

describe("a blank description takes the type's name", () => {
  const NAMES: [TxBucket, string][] = [["NEEDS", "Needs"], ["WANTS", "Wants"], ["SAVINGS", "Savings"], ["INCOME", "Income"], ["TRANSFER", "Transfer"]];

  it.each(NAMES)("a %s entry emptied and saved is called %s", (bucket, name) => {
    const s = open(row({ bucket, amount: bucket === "TRANSFER" ? -12 : 12 }));
    fireEvent.change(s.desc, { target: { value: "   " } });
    fireEvent.click(s.save);
    expect(s.saved()?.description).toBe(name);
  });

  it("the name is the type being saved: a Needs entry changed to Wants and emptied is called Wants", () => {
    const s = open(row());
    fireEvent.click(screen.getByRole("button", { name: /Wants/ }));
    fireEvent.change(s.desc, { target: { value: "" } });
    fireEvent.click(s.save);
    expect(s.saved()?.bucket).toBe("WANTS");
    expect(s.saved()?.description).toBe("Wants");
  });

  it("a typed description is kept, trimmed", () => {
    const s = open(row());
    fireEvent.change(s.desc, { target: { value: "  Milk  " } });
    fireEvent.click(s.save);
    expect(s.saved()?.description).toBe("Milk");
  });

  it("the sheet and the form use one rule: the form's old expression, for every type", () => {
    for (const [bucket] of NAMES) {
      expect(entryDescription("", bucket)).toBe(bucket.charAt(0) + bucket.slice(1).toLowerCase());
      expect(entryDescription(" Rent ", bucket)).toBe("Rent");
    }
  });

  it("the form's two paths and the sheet call it (no copy of the rule left)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = (p: string) => readFileSync(join(__dirname, p), "utf8");
    const form = src("inputpanel/EntrySection.tsx");
    const sheet = src("EditTransactionSheet.tsx");
    expect(form.match(/entryDescription\(txDesc, txBucket\)/g)?.length).toBe(2);
    expect(sheet).toMatch(/entryDescription\(desc, keptBucket\)/);
    for (const s of [form, sheet]) expect(s).not.toMatch(/charAt\(0\) \+ \w+\.slice\(1\)\.toLowerCase\(\)/);
  });
});
