// "Reset all data" no longer lives on My Finances -- it moved to Profile's
// Danger zone, next to Delete account. A destructive control in a footer
// beside "Saved in your browser" was one misclick-and-type from wiping the
// account, and its confirm understated what it did.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

afterEach(cleanup);

function renderPanel(over: Partial<LocalFinancials> = {}) {
  const data = { ...DEFAULT_DATA, income: 3000, ...over } as LocalFinancials;
  render(<InputPanel financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
}

describe("My Finances has no reset", () => {
  it("the button is gone", () => {
    renderPanel();
    // Premise: the panel rendered, so an absent button is not an absent panel.
    expect(screen.getByRole("button", { name: /Manage/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reset all data/i })).toBeNull();
  });

  it("the footer says where data lives, accurately for each backup state", () => {
    renderPanel();
    expect(document.body.textContent).toMatch(/Saved in your browser/);
    expect(document.body.textContent).not.toMatch(/backed up/i);
    cleanup();
    renderPanel({ syncChoice: { enabled: true, decidedAt: "2026-09-28T10:00:00.000Z" } });
    expect(document.body.textContent).toMatch(/backed up to ESSA's server/i);
  });
});
