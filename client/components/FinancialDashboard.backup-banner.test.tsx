// COPY-05 (blind-spot audit; raised by the owner 2026-09-30): the Overview's
// "never been backed up … go to Profile and push a backup" banner showed on
// an account that had chosen backup OFF. It kept urging an upload the user
// had declined, and following it uploads everything (a manual push isn't
// gated). Owner's rule: with backup off, nothing prompts an upload.
//
// The banner now consults the backup choice. With backup on, or still
// undecided, it shows as before; its wording is unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import FinancialDashboard from "./FinancialDashboard";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };

beforeEach(() => { localStorage.clear(); }); // no last-sync time: never backed up
afterEach(() => { cleanup(); });

function show(syncChoice?: LocalFinancials["syncChoice"]) {
  const data = { ...DEFAULT_DATA, income: 3000, ...(syncChoice ? { syncChoice } : {}) } as LocalFinancials;
  render(<FinancialDashboard data={computeDashboard(data)} financials={data} />);
}
const banner = () => screen.queryByText(/never been backed up/i);

describe("the never-backed-up banner", () => {
  it("backup off: no prompt to upload", () => {
    show({ enabled: false, decidedAt: "2026-09-28T12:00:00.000Z" });
    expect(banner()).toBeNull();
  });

  it("backup on, never synced: shown as before", () => {
    show({ enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" });
    expect(banner()).not.toBeNull();
  });

  it("undecided: shown as before", () => {
    show(undefined);
    expect(banner()).not.toBeNull();
  });
});
