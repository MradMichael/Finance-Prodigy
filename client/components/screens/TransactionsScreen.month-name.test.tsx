// A11Y-04, its second half (owner-approved name, session 8): the month picker
// on Transactions had no accessible name, so a screen reader announced
// "combo box" and nothing about what it chooses (axe select-name). It is
// named "Month".
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import TransactionsScreen from "./TransactionsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";

afterEach(cleanup);

it("the month picker is named \"Month\"", () => {
  const data = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
  render(<ThemeProvider><TransactionsScreen financials={data} onChange={vi.fn()} onEdit={vi.fn()} /></ThemeProvider>);
  const picker = screen.queryByRole("combobox", { name: "Month" });
  expect(picker).not.toBeNull();
  expect(picker!.querySelector("option[value=all]")?.textContent).toBe("All time");
});
