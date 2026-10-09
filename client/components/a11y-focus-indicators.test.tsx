// A11Y-05, its focus half: two controls showed no focus indicator, their
// outline removed with nothing in its place. The day, month and year boxes of
// DateFieldDMY (every date in the app) and Overview's past-month picker. Each
// now shows one while it has focus, and only then. (Statistics' keyboard
// scrolling, the finding's other half, needs a design call on an extra Tab
// stop and is left for the owner.)
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DateFieldDMY } from "./form/Primitives";
import FinancialDashboard from "./FinancialDashboard";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
afterEach(cleanup);

const shows = (el: HTMLElement) => {
  const s = el.style;
  return (!!s.boxShadow && s.boxShadow !== "none") || (!!s.outline && s.outline !== "none" && !s.outline.startsWith("0"));
};

it.each(["DD", "MM", "YYYY"])("the date field's %s box shows focus while it has it, and only then", async (ph) => {
  render(<ThemeProvider><DateFieldDMY value="2026-10-09" onChange={vi.fn()} /></ThemeProvider>);
  const boxes = ["DD", "MM", "YYYY"].map((p) => screen.getByPlaceholderText(p));
  const box = screen.getByPlaceholderText(ph);
  expect(boxes.some(shows)).toBe(false);
  fireEvent.focus(box);
  expect(shows(box)).toBe(true);
  expect(boxes.filter(shows)).toEqual([box]); // the one with focus, not its neighbours
  fireEvent.blur(box);
  expect(shows(box)).toBe(false);
});

it("Overview's past-month picker shows focus while it has it, and only then", () => {
  const old = { id: "t-old", amount: 20, currency: "USD", bucket: "NEEDS", description: "Bread", date: "2026-01-10" } as StoredTransaction;
  const data = { ...DEFAULT_DATA, income: 3000, transactions: [old] } as LocalFinancials;
  render(<ThemeProvider><FinancialDashboard data={computeDashboard(data)} financials={data} /></ThemeProvider>);
  const picker = document.getElementById("past-month-select") as HTMLSelectElement;
  expect(picker).not.toBeNull();
  expect(shows(picker)).toBe(false);
  fireEvent.focus(picker);
  expect(shows(picker)).toBe(true);
  fireEvent.blur(picker);
  expect(shows(picker)).toBe(false);
});
