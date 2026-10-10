// "Reset all data" moves from the My Finances footer to Profile's Danger zone,
// behind a stronger confirm. The old confirm said it "permanently erases every
// transaction, goal, debt..." and never mentioned the server copy, which the
// reset then overwrote with an empty dataset seconds later via auto-sync.
// With opt-in sync that only happens when backup is on -- so the confirm says
// which, and names what is about to go.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ResetDataPanel from "./ResetDataPanel";
import { resetFinancials, DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

afterEach(cleanup);
const COUNTS = { transactions: 84, goals: 4, debts: 3, recurring: 3 };

describe("resetFinancials", () => {
  it("clears the financial data but keeps the backup choice", () => {
    // A reset erases data, not a consent decision: silently turning backup
    // off (or back to undecided) would be a second change the owner did not ask for.
    const choice = { enabled: true, decidedAt: "2026-09-28T10:00:00.000Z" };
    const d = { ...DEFAULT_DATA, income: 3000, goals: [{ id: "g" }], syncChoice: choice } as unknown as LocalFinancials;
    const out = resetFinancials(d, new Date("2026-10-07T18:00:00.000Z"));
    // DI-13: beside the cleared data, the deletion it records for each item;
    // session 10 (held): and the reset's moment, the same as theirs.
    const { deletedKeys, resetAt, ...rest } = out;
    expect(rest).toEqual({ ...DEFAULT_DATA, syncChoice: choice });
    expect(deletedKeys).toEqual({ goals: [{ key: "g", deletedAt: "2026-10-07T18:00:00.000Z" }] });
    expect(resetAt).toBe("2026-10-07T18:00:00.000Z");
  });
  it("an undecided account stays undecided", () => {
    expect(resetFinancials({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials).syncChoice).toBeUndefined();
  });
});

describe("ResetDataPanel", () => {
  const open = (backupOn: boolean, onConfirm = vi.fn()) => {
    render(<ResetDataPanel counts={COUNTS} backupOn={backupOn} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /reset all data/i }));
    return onConfirm;
  };

  it("names what is about to be erased", () => {
    open(false);
    const t = document.body.textContent ?? "";
    expect(t).toMatch(/84 transactions/); expect(t).toMatch(/4 goals/);
    expect(t).toMatch(/3 debts/); expect(t).toMatch(/3 recurring/);
  });

  it("backup ON: says the server copy is replaced and other devices follow", () => {
    open(true);
    const t = document.body.textContent ?? "";
    expect(t).toMatch(/replaces your backup on our server/i);
    expect(t).toMatch(/other devices/i);
    // Owner's wording (session 11): other devices take the reset, settings
    // included (lib/reset-propagates.test.ts has the merge). It replaces
    // session 4's "... but keep their own settings", no longer true.
    expect(t).toContain("Backup is on, so this also replaces your backup on our server with the empty copy. Your other devices are reset the same way the next time they sync, settings included.");
    expect(t).not.toMatch(/keep their own settings/);
  });

  it("backup OFF: says it is this device only", () => {
    open(false);
    expect(document.body.textContent).toMatch(/only on this device/i);
    expect(document.body.textContent).not.toMatch(/replaces your backup/i);
  });

  it("confirms only on the typed word, and keeps the account", () => {
    const onConfirm = open(false);
    const btn = screen.getByRole("button", { name: /^erase everything$/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/type reset to confirm/i), { target: { value: "reset" } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toMatch(/your account stays/i);
  });
});
