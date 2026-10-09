// Plan H 5a (owner-approved amendment, session 6): changing what a goal has
// saved now writes a correction row too (buildGoalCorrectionTx: a $0 row in
// the transaction list, deletable like any other), so the sentence listing
// the entries ESSA writes itself names it beside the emergency fund and debts.
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import PrivacyPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { buildGoalCorrectionTx, type StoredGoal } from "../../lib/localData";

afterEach(cleanup);

it("names goal corrections among the entries ESSA writes itself", () => {
  render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
  const section = screen.getByRole("heading", { name: "What we collect" }).closest("section")!;
  expect((section.textContent ?? "").replace(/\s+/g, " ")).toContain(
    "Some entries are written by ESSA rather than typed by you: when you confirm what your emergency fund or a debt actually holds, " +
    "or change what a goal has saved, and it differs from ESSA's own figure, the difference is recorded as a correction in your " +
    "transaction list — visible and reversible, rather than a number changing silently.",
  );
});

it("the claim holds: a goal correction is a row in the transaction list", () => {
  const goal = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" } as StoredGoal;
  expect(buildGoalCorrectionTx(goal, 25)).toMatchObject({ amount: 0, goalId: "g1", goalAmount: 25 });
});
