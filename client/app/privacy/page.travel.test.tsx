// Travel slice 1: the owner-approved privacy sentences ship with it
// (session 13's drafts, approved session 14). LAST_UPDATED moves to the day
// it merges (session 15: 12 October 2026).
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import PrivacyPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);
const text = () => { render(<ThemeProvider><PrivacyPage /></ThemeProvider>); return (document.body.textContent ?? "").replace(/\s+/g, " "); };

it("financial data names trips, foreign cash and the exchange rates you record", () => {
  expect(text()).toContain("Financial data: transactions, goals, debts, recurring payments, trips, foreign cash and the exchange rates you record, and anything else you enter");
});

it("ESSA doesn't fetch exchange rates", () => {
  expect(text()).toContain("ESSA doesn't fetch exchange rates: the only rates it stores are the ones you enter.");
});

it("is dated the day these sentences shipped", () => {
  expect(text()).toContain("Last updated: 12 October 2026");
});
