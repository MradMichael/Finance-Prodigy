// Session 24, item 1 (DRAFT WORDING, HELD): Erase's confirmation counts what the
// readable record holds. When the account also has a copy kept of a record
// that couldn't be opened, Erase removes it too, and the confirmation says so
// in one more sentence, shown only then.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ResetDataPanel from "./ResetDataPanel";
import { ThemeProvider } from "../contexts/ThemeContext";
import { hasUnreadableCopies } from "../lib/localData";

afterEach(() => { cleanup(); localStorage.clear(); });
const SENTENCE = "This also removes the copy kept of data this browser couldn't open.";
const COUNTS = { transactions: 3, goals: 1, debts: 0, recurring: 2 };
const open = (hasKeptCopy: boolean) => {
  render(<ThemeProvider><ResetDataPanel counts={COUNTS} backupOn={false} onConfirm={vi.fn()} hasKeptCopy={hasKeptCopy} /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Reset all data" }));
};

it("with a kept copy, the confirmation says Erase removes it too", () => {
  open(true);
  expect(screen.getByText(SENTENCE)).toBeTruthy();
});

it("without one, the confirmation is as before", () => {
  open(false);
  expect(screen.queryByText(SENTENCE)).toBeNull();
});

it("hasUnreadableCopies sees only this account's copies", () => {
  expect(hasUnreadableCopies("u1")).toBe(false);
  localStorage.setItem("essa_unreadable_u10_2026-10-15T09:00:00.000Z", "x");
  expect(hasUnreadableCopies("u1")).toBe(false);
  localStorage.setItem("essa_unreadable_u1_2026-10-15T09:00:00.000Z", "x");
  expect(hasUnreadableCopies("u1")).toBe(true);
});
