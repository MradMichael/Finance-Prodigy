// Plan H 5b (owner-approved, session 6) with PRIV-02 (decided 2026-09-29):
// what "Download my data" leaves out, said plainly. The export is the
// account's stored data with deleted transactions filtered out
// (app/profile/page.tsx: activeTransactions), and each device's sync record
// (lib/syncSeen.ts), its sync time and its memory of the notices it has shown
// (lib/clashNotice.ts) are stored outside that data altogether. Session 8
// (owner-approved draft A): the sentence names all of them, not the record alone.
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import PrivacyPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

it("says the export is all your data, and what it leaves out", () => {
  render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
  const section = screen.getByRole("heading", { name: "Taking your data with you" }).closest("section")!;
  expect((section.textContent ?? "").replace(/\s+/g, " ").trim()).toBe(
    "Taking your data with you" +
    "Profile → Download my data exports all your data: transactions, goals, debts, recurring payments, settings, as a JSON file, anytime, with no restriction. " +
    "It leaves out only transactions you've deleted, and the small records each device keeps to combine copies and to tell you about a change only once, which aren't your data. " +
    "Yours to keep, move elsewhere, or back up by hand.",
  );
});
