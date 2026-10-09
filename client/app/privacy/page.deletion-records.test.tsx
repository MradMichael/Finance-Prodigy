// DI-13 (owner-approved, session 4): the privacy page says that deleting an
// item, or resetting all data, leaves a short record of the deletion, synced
// with backup on, and kept until the account is deleted. Checked before
// writing it: nothing in the code ever prunes a deletion record
// (recordDeletion only adds or replaces; the reset keeps them; the field's
// own comment says "kept for good"), and deleting the account removes them
// with everything else.
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import PrivacyPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import TransactionsScreen from "../../components/screens/TransactionsScreen";
import { DEFAULT_DATA, DELETED_TRANSACTION_RETENTION_DAYS, type LocalFinancials, type StoredTransaction } from "../../lib/localData";

afterEach(cleanup);

it("says what a deletion leaves behind, and for how long, under Deleting your data", () => {
  render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
  const section = screen.getByRole("heading", { name: "Deleting your data" }).closest("section")!;
  expect((section.textContent ?? "").replace(/\s+/g, " ")).toContain(
    "When you delete an item, or reset all data, ESSA keeps a short record that it was deleted — its internal key (for a custom category, its name in lowercase) and when — so your other devices remove it too. " +
    // Session 5 (owner-approved amendment): a deleted transaction keeps more.
    // Session 6 (owner-approved, tighter): "up to" 30 days, because Delete
    // permanently ends it at once and the purge runs only when ESSA is opened.
    // "Recently deleted" and "Delete permanently" are the Transactions
    // screen's own labels, verbatim (checked below).
    "A deleted transaction is kept in full for up to 30 days, so you can restore it under Recently deleted, or remove it at once with Delete permanently; after that, the next time ESSA is opened, only its date, currency and budget bucket remain with that record. " +
    "These records are stored with the rest of your data, in the server copy too if backup is on, and are kept until you delete your account, which removes them.",
  );
});

it("names the Transactions screen's labels exactly as the screen shows them", () => {
  render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
  expect(document.body.textContent).toContain("restore it under Recently deleted, or remove it at once with Delete permanently;");
  cleanup();
  // The screen's own labels, so the page and the screen can't drift apart.
  const deleted = { id: "t1", amount: 46.8, currency: "USD", bucket: "WANTS", description: "Bistro Margaux", date: "2026-10-01", deletedAt: "2026-10-05T09:00:00.000Z" } as StoredTransaction;
  render(<TransactionsScreen financials={{ ...DEFAULT_DATA, transactions: [deleted] } as LocalFinancials} onChange={vi.fn()} onEdit={vi.fn()} />);
  const recently = screen.getByRole("button", { name: /Recently deleted/ });
  expect(recently.textContent?.replace(/^\W+/u, "").replace(/\d+$/, "").trim()).toBe("Recently deleted"); // its count badge aside
  fireEvent.click(recently);
  expect(screen.getByRole("button", { name: "Delete permanently" }).textContent?.trim()).toBe("Delete permanently");
});

it("the 30 days is the retention the purge uses", () => {
  expect(DELETED_TRANSACTION_RETENTION_DAYS).toBe(30);
});
