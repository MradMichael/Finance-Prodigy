// Rate staleness, phase 3 commit 2 (owner-approved 2026-11-05): the rate and
// its age, in one line, where a lira amount is about to be entered. Reads
// rateAge, so it says nothing exactly when the Currency screen says nothing.
//
// The wording names the rate and when it was last checked, never "this
// entry uses": an entry is stored with the live rate, but a backdated one is
// priced at its own day's rate (rateOn), so that claim would be false for it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import RateAgeChip from "./RateAgeChip";
import { ThemeProvider } from "../contexts/ThemeContext";

const NOW = new Date(2026, 10, 5, 10);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const daysAgo = (n: number) => new Date(2026, 10, 5 - n, 9).toISOString();
const chip = (updatedAt: string | undefined, rate = 89_500) =>
  render(<ThemeProvider><RateAgeChip updatedAt={updatedAt} rate={rate} /></ThemeProvider>);
const text = () => document.body.textContent ?? "";

describe("RateAgeChip", () => {
  it("says nothing when the rate was checked under 3 days ago", () => {
    chip(daysAgo(2));
    expect(text()).toBe("");
  });

  it("says nothing when the rate has never been edited (owner's answer 3)", () => {
    chip(undefined);
    expect(text()).toBe("");
  });

  it("from 3 days: the rate and its age, in the nudge colour", () => {
    chip(daysAgo(5));
    const el = screen.getByText("Rate L£89,500 per $1, last checked 5 days ago.");
    expect(el.getAttribute("data-level")).toBe("nudge");
  });

  it("from 14 days: the same line, in the stale colour", () => {
    chip(daysAgo(20), 100_000);
    const el = screen.getByText("Rate L£100,000 per $1, last checked 20 days ago.");
    expect(el.getAttribute("data-level")).toBe("stale");
  });

  it("nudge and stale are told apart by colour, as the Currency screen's warning is", () => {
    chip(daysAgo(5));
    const nudge = screen.getByText(/last checked/) as HTMLElement;
    const brass = nudge.style.color;
    cleanup();
    chip(daysAgo(20));
    const stale = screen.getByText(/last checked/) as HTMLElement;
    expect(brass).not.toBe("");
    expect(stale.style.color).not.toBe(brass);
  });
});
