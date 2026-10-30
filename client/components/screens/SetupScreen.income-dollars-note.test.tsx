// CUR-03 (owner, session 30, DECISIONS_PENDING entry 4 (a)): income and the
// safety net stay in dollars, and Setup says so, under the income field.
// The wording, drafted in session 30, approved and merged in session 31.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import SetupScreen from "./SetupScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

afterEach(cleanup);

const NOTE = "Income and your safety net are kept in dollars. If you're paid or save in lira, enter the dollar value at today's rate, and update it when the rate moves.";

it("under the income field, Setup says income and the safety net are in dollars, and what to do with lira", () => {
  const d = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
  render(<ThemeProvider><SetupScreen financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} /></ThemeProvider>);
  const note = screen.getByText(NOTE);
  const income = document.getElementById("setup-income")!;
  expect(income.parentElement!.contains(note)).toBe(true);
});
