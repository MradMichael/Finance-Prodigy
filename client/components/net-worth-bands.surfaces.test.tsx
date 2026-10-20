// Item 4a (owner, session 25; merged in session 26): what the net worth bands change on screen.
// With no income set there's no tier: Overview shows the figure without a tier
// and the owner's sentence where the advice was; the report shows the figure
// without " · <tier>". (Journey's colour reads tierColor, "mute" with no
// income, pinned in lib/net-worth-bands.test.ts.)
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import FinancialDashboard from "./FinancialDashboard";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { buildReportHtml } from "../lib/printReport";
import { DEFAULT_DATA, type LocalFinancials, type StoredAsset } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
vi.mock("../lib/auth", () => ({ getSession: () => ({ userId: "u1", email: "u1@example.test", name: "U One" }), getRecoveryTokenForSync: vi.fn(async () => null) }));

beforeEach(() => { localStorage.clear(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ exists: true }), { status: 200 }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const SENTENCE = "Set your monthly income to see where your net worth stands.";
const asset = { id: "a1", name: "Car", value: 4841, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" } as StoredAsset;
const data = (income: number) => ({ ...DEFAULT_DATA, income, assets: [asset] }) as LocalFinancials;
const show = (d: LocalFinancials) => render(<ThemeProvider><FinancialDashboard data={computeDashboard(d)} financials={d} /></ThemeProvider>);

it("Overview with no income: the figure, no tier, and the sentence where the advice was", () => {
  show(data(0));
  expect(screen.getByText("+$4,841")).toBeTruthy();
  expect(screen.getByText(SENTENCE)).toBeTruthy();
  for (const tier of ["Breaking even", "Foundation builder", "Growing wealth"]) expect(screen.queryByText(tier)).toBeNull();
  expect(screen.getByText("+$4,841").parentElement!.querySelector("span.rounded-full")).toBeNull(); // no empty tier pill
});

it("Overview with income: the tier by months of income, and no sentence", () => {
  show(data(1500));
  expect(screen.getByText("Foundation builder")).toBeTruthy();
  expect(screen.getByText("+$4,841").parentElement!.querySelector("span.rounded-full")?.textContent).toBe("Foundation builder");
  expect(screen.queryByText(SENTENCE)).toBeNull();
});

it("the report with no income: the net worth figure without \" · <tier>\"", () => {
  const d = data(0);
  const html = buildReportHtml("Quartz Lantern", d, computeDashboard(d));
  const card = html.match(/<div class="label">Net worth<\/div><div class="value">([^<]*)<\/div>/)?.[1];
  expect(card).toBe("$4,841");
});

it("the report with income: the figure and its tier", () => {
  const d = data(800);
  const html = buildReportHtml("Quartz Lantern", d, computeDashboard(d));
  expect(html.match(/<div class="label">Net worth<\/div><div class="value">([^<]*)<\/div>/)?.[1]).toBe("$4,841 &middot; Growing wealth");
});
