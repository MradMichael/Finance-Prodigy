// D3 (owner, 2026-11-05): the Overview's export reminder. Its wording is a DRAFT, held for the owner's approval.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import FinancialDashboard from "./FinancialDashboard";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, getRecoveryTokenForSync: vi.fn(async () => null) }));

const REMINDER = "Backup is off, so your data is only on this device. Download a copy every couple of weeks to keep one safe.";
const DAY = 86_400_000;
const OFF = { enabled: false, decidedAt: "2026-09-28T12:00:00.000Z" };
const ON = { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" };

let createObjectURL: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T09:00:00.000Z"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ exists: true }), { status: 200 })));
  createObjectURL = vi.fn(() => "blob:essa");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function show(syncChoice: LocalFinancials["syncChoice"]) {
  const data = { ...DEFAULT_DATA, income: 3000, syncChoice } as LocalFinancials;
  render(<FinancialDashboard data={computeDashboard(data)} financials={data} />);
}
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

describe("the export reminder", () => {
  it("backup off, clock started 14 days ago, no download: shown, with its two answers", () => {
    localStorage.setItem("essa_export_clock_u1", daysAgo(14));
    show(OFF);
    expect(screen.getByText(REMINDER)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download my data" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  });

  it("not shown at 13 days, with backup on, or on the first look (which starts the clock)", () => {
    localStorage.setItem("essa_export_clock_u1", daysAgo(13));
    show(OFF);
    expect(screen.queryByText(REMINDER)).toBeNull();
    cleanup();
    localStorage.setItem("essa_export_clock_u1", daysAgo(30));
    show(ON);
    expect(screen.queryByText(REMINDER)).toBeNull();
    cleanup();
    localStorage.clear();
    show(OFF);
    expect(screen.queryByText(REMINDER)).toBeNull();
    expect(localStorage.getItem("essa_export_clock_u1")).toBe(new Date().toISOString());
  });

  it("'Download my data' downloads the file here, records it, and the reminder goes", () => {
    localStorage.setItem("essa_export_clock_u1", daysAgo(20));
    show(OFF);
    fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("essa_last_export_u1")).toBe(new Date().toISOString());
    expect(screen.queryByText(REMINDER)).toBeNull();
  });

  it("'Not now' restarts the clock, and the reminder goes", () => {
    localStorage.setItem("essa_export_clock_u1", daysAgo(20));
    show(OFF);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(localStorage.getItem("essa_export_clock_u1")).toBe(new Date().toISOString());
    expect(screen.queryByText(REMINDER)).toBeNull();
  });
});
