// Session 22, item 3 (wording drafts, HELD), on screen:
// - ERR-06: a brand-new account scored 44, "Gaining ground", from two
//   sub-scores that read 100 because nothing was there to measure (0% of $0
//   on essentials, no debt payments). No score now until there's income and
//   at least one entry; the report says the same.
// - COPY-04: Journey said "Keep this pace and your safety net is complete
//   by X". The pace is the budget's recommended savings, not the user's (the
//   2.4.70 basis, which Projections labels "At recommended pace"); it now
//   says so, with the amount.
// - COPY-07: the Overview's headline said "You kept $X this cycle" from the
//   cycle's first minutes; the figure is income minus spending so far, and
//   now reads that way.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import FinancialDashboard from "./FinancialDashboard";
import JourneyScreen from "./screens/JourneyScreen";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { buildReportHtml } from "../lib/printReport";
import { periodNoun } from "../lib/period";
import { projectCompletion } from "../lib/projections";
import { DEFAULT_DATA, todayISO, cycleStartDayOf, type LocalFinancials, type StoredTransaction } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
vi.mock("../lib/auth", () => ({ getSession: () => ({ userId: "u1", email: "u1@example.test", name: "Quartz Lee" }), getRecoveryTokenForSync: vi.fn(async () => null) }));

beforeEach(() => { localStorage.clear(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ exists: true }), { status: 200 }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = (data: LocalFinancials) => render(<ThemeProvider><FinancialDashboard data={computeDashboard(data)} financials={data} /></ThemeProvider>);
const spent = (amount: number) => ({ id: "t1", amount, currency: "USD", bucket: "WANTS", category: "dining", description: "Coffee", date: todayISO() }) as StoredTransaction;
const NO_SCORE = "No score yet";
const NO_SCORE_WHY = "Your score appears once you've set your income and logged your first entry.";
const exact = (text: string) => screen.queryByText((_, el) => !!el && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text));

it("ERR-06: a brand-new account isn't scored: no 44, no \"Gaining ground\", no sub-scores", () => {
  const data = { ...DEFAULT_DATA, userName: "Quartz Lee" } as LocalFinancials;
  expect(computeDashboard(data).health.measured).toBe(false);
  show(data);
  expect(screen.getByText(NO_SCORE)).toBeTruthy();
  expect(screen.getByText(NO_SCORE_WHY)).toBeTruthy();
  expect(screen.queryByText("Gaining ground")).toBeNull();
  expect(screen.queryByText("Needs discipline")).toBeNull();
});

it("ERR-06: income alone, nothing logged: still not scored", () => {
  const data = { ...DEFAULT_DATA, userName: "Quartz Lee", income: 3000 } as LocalFinancials;
  expect(computeDashboard(data).health.measured).toBe(false);
  show(data);
  expect(screen.getByText(NO_SCORE)).toBeTruthy();
});

it("ERR-06: income and one entry: scored, as before", () => {
  const data = { ...DEFAULT_DATA, userName: "Quartz Lee", income: 3000, transactions: [spent(100)] } as LocalFinancials;
  const dash = computeDashboard(data);
  expect(dash.health.measured).toBe(true);
  show(data);
  expect(screen.queryByText(NO_SCORE)).toBeNull();
  expect(screen.getByText(dash.health.grade)).toBeTruthy();
  expect(screen.getByText("Needs discipline")).toBeTruthy();
});

it("ERR-06: the printed report says the same, not \"44 / 100\"", () => {
  const data = { ...DEFAULT_DATA, userName: "Quartz Lee" } as LocalFinancials;
  const html = buildReportHtml("Quartz Lee", data, computeDashboard(data));
  expect(html).toContain(`<div class="value">${NO_SCORE}</div>`);
  expect(html).not.toContain("44 / 100");
});

it("COPY-07: the headline reads \"so far\", in the present perfect", () => {
  const data = { ...DEFAULT_DATA, userName: "Quartz Lee", income: 3000, transactions: [spent(100)] } as LocalFinancials;
  show(data);
  const noun = periodNoun(cycleStartDayOf(data));
  expect(exact(`You've kept $2,900 so far this ${noun}, Quartz. Every dollar counts.`)).not.toBeNull();
  expect(screen.queryByText(/You kept/)).toBeNull();
});

it("COPY-04: Journey names the recommended pace and its amount, not \"this pace\"", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 6, 15));
  try {
    const data = { ...DEFAULT_DATA, income: 1000, budgetRule: "50-30-20" } as LocalFinancials;
    const dash = computeDashboard(data);
    render(<ThemeProvider><JourneyScreen financials={data} dashData={dash} onNavigate={vi.fn()} /></ThemeProvider>);
    const date = projectCompletion(dash.emergencyFund.remaining, dash.budgetTargets.savings, dash.anchor).dateDisplay;
    const noun = periodNoun(cycleStartDayOf(data));
    expect(exact(`Saving the recommended $200 each ${noun}, your safety net is complete by ${date}.`)).not.toBeNull();
    expect(screen.queryByText(/Keep this pace/)).toBeNull();
  } finally { vi.useRealTimers(); }
});
