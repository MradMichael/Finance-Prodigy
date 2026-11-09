// Phase 2.8.3 (LB1; plan approved in session 47): every screen reads one rule
// for "achieved", goalAchievement() (lib/localData.ts):
//   - achieved means what's saved is at or over the target;
//   - its date is the latest crossing that still stands (else the before-ledger
//     record);
//   - the percent is 100 only when achieved, otherwise at most 99.
// The cases are session 46's probe, now assertions; the last block is the plan's
// worked example. Approved wording (session 47), for Projections when the goals
// left are paused rather than achieved: "Nothing left to plan: every goal is
// achieved or paused."
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GoalsScreen from "./screens/GoalsScreen";
import InputPanel from "./InputPanel";
import ProjectionsScreen from "./screens/ProjectionsScreen";
import JourneyScreen from "./screens/JourneyScreen";
import FinancialDashboard from "./FinancialDashboard";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { buildReportHtml } from "../lib/printReport";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal, type StoredTransaction } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 9, 12, 0), toFake: ["Date"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const goal = (o: Partial<StoredGoal>): StoredGoal => ({
  id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-03-01",
  createdAt: "2026-05-01T09:00:00.000Z", ...o,
});
let n = 0;
const row = (goalId: string, date: string, amount: number, o: Partial<StoredTransaction> = {}): StoredTransaction => ({
  id: `c${++n}`, amount, currency: "USD", bucket: "SAVINGS", description: "Goal", date, goalId, createdAt: `${date}T09:00:00.000Z`, ...o,
}) as StoredTransaction;
const data = (goals: StoredGoal[], transactions: StoredTransaction[] = []) =>
  ({ ...DEFAULT_DATA, income: 3000, budgetRule: "50-30-20", goals, transactions }) as LocalFinancials;

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ");
function overviewCard(d: LocalFinancials, name: string) {
  render(<FinancialDashboard data={computeDashboard(d)} financials={d} />);
  return screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").endsWith(name)).closest("div.rounded-xl") as HTMLElement;
}
function goalsCard(d: LocalFinancials, name: string) {
  render(<ThemeProvider><GoalsScreen dashData={computeDashboard(d)} financials={d} onChange={vi.fn()} onEdit={vi.fn()} /></ThemeProvider>);
  return screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").includes(name) && el.className.includes("font-medium")).closest("div.rounded-2xl") as HTMLElement;
}
async function myFinancesRow(d: LocalFinancials, name: string) {
  render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  await user.click(screen.getByRole("button", { name: /Manage/ }));
  await user.click(screen.getByRole("button", { name: /Goals/ }));
  return screen.getByText((_, el) => el?.tagName === "SPAN" && el.className.includes("truncate") && (el.textContent ?? "").endsWith(name)).closest("div.rounded-xl") as HTMLElement;
}
function journey(d: LocalFinancials) {
  render(<JourneyScreen financials={d} dashData={computeDashboard(d)} onNavigate={vi.fn()} />);
  return text(document.body).match(/(\d+) ?goals? achieved/)?.[1] ?? null;
}
function projections(d: LocalFinancials) {
  render(<ProjectionsScreen financials={d} dashData={computeDashboard(d)} />);
  return text(document.body);
}
const pdfPercent = (d: LocalFinancials, name: string) =>
  buildReportHtml("Quartz Runner", d, computeDashboard(d)).replace(/\s+/g, " ").match(new RegExp(`${name}</td>.*?<td class="num">(\\d+)%</td>`))?.[1];

describe("99.5% saved ($1,194 of $1,200): not achieved anywhere, 99%", () => {
  const d = data([goal({ openingAmount: 300 })], [row("g1", "2026-08-10", 400), row("g1", "2026-09-12", 300), row("g1", "2026-10-05", 194)]);

  it("the dashboard says so", () => {
    expect(computeDashboard(d).goals[0]).toMatchObject({ achieved: false, achievedOn: null, projection: expect.objectContaining({ pctComplete: 99 }) });
  });
  it("Overview: a pace badge, 99%, and the schedule line", () => {
    const c = overviewCard(d, "Laptop");
    expect(within(c).queryByText("achieved!")).toBeNull();
    expect(within(c).getByText(/^(on pace|behind pace)$/)).toBeTruthy();
    expect(text(c)).toContain("99%");
    expect(text(c)).toMatch(/keeps this on schedule for 01\/03\/2027/);
  });
  it("Goals: no ✓, a pace badge, 99%, and Add payment", () => {
    const c = goalsCard(d, "Laptop");
    expect(text(c)).not.toContain("✓");
    expect(within(c).queryByText("achieved!")).toBeNull();
    expect(text(c)).toContain("99%");
    expect(within(c).getByText(/Add payment/)).toBeTruthy();
  });
  it("My Finances: 99%, no badge", async () => {
    const r = await myFinancesRow(d, "Laptop");
    expect(text(r)).toContain("99%");
    expect(text(r)).not.toContain("Achieved");
    expect(text(r)).toContain("$6.00 to go");
  });
  it("Projections plans it; the PDF says 99%", () => {
    const p = projections(d);
    expect(p).toContain("99% saved");
    expect(p).not.toContain("All goals achieved");
    cleanup();
    expect(pdfPercent(d, "Laptop")).toBe("99");
  });
});

describe("the row that reached it, deleted ($400 of $600, stamped 2 Oct): not achieved anywhere", () => {
  const d = data([goal({ name: "Phone", emoji: "📱", targetAmount: 600, openingAmount: 400, achievedAt: "2026-10-02" })],
    [row("g1", "2026-10-02", 200, { deletedAt: "2026-10-20T09:00:00.000Z" })]);
  it("My Finances: no 'Achieved', no date", async () => {
    const r = await myFinancesRow(d, "Phone");
    expect(text(r)).not.toContain("Achieved");
    expect(text(r)).toContain("$200.00 to go");
  });
  it("Journey doesn't count it", () => {
    expect(journey(d)).toBeNull();
  });
});

describe("dates", () => {
  it("a backdated row: 'Achieved 28/09/2026', not the day it was typed in", async () => {
    const d = data([goal({ name: "Phone", emoji: "📱", targetAmount: 600, openingAmount: 400, achievedAt: "2026-10-02" })],
      [row("g1", "2026-09-28", 200, { createdAt: "2026-10-02T09:00:00.000Z" })]);
    expect(text(await myFinancesRow(d, "Phone"))).toContain("Achieved 28/09/2026");
  });

  // The edit sheet stamped an instant at 01:30 on 3 October in Beirut; no row crosses (before the ledger).
  const LOCAL_DAY: Record<string, string> = { UTC: "02/10/2026", "Asia/Beirut": "03/10/2026", "America/Los_Angeles": "02/10/2026" };
  const ZONE = process.env.TZ ?? "";
  it.runIf(ZONE in LOCAL_DAY)(`a before-ledger instant stamp reads as its local day [${ZONE}]`, async () => {
    const d = data([goal({ targetAmount: 1200, openingAmount: 1300, achievedAt: "2026-10-02T22:30:00.000Z" })]);
    expect(text(await myFinancesRow(d, "Laptop"))).toContain(`Achieved ${LOCAL_DAY[ZONE]}`);
  });
});

describe("paused", () => {
  it("a reached, paused goal: 'Achieved' and 'Paused' in My Finances, counted in Journey (owner, session 47)", async () => {
    const d = data([goal({ name: "Wedding gift", emoji: "🎁", targetAmount: 300, openingAmount: 300, pausedAt: "2026-10-01T09:00:00.000Z" })]);
    const r = await myFinancesRow(d, "Wedding gift");
    expect(within(r).getByText("Achieved")).toBeTruthy();
    expect(within(r).getByText("Paused")).toBeTruthy();
    cleanup();
    expect(journey(d)).toBe("1");
  });

  it("Projections, the only goal paused and not reached: the approved line, not 'All goals achieved'", () => {
    const p = projections(data([goal({ openingAmount: 300, pausedAt: "2026-10-01T09:00:00.000Z" })]));
    expect(p).toContain("Nothing left to plan: every goal is achieved or paused.");
    expect(p).not.toContain("All goals achieved");
  });

  it("Projections, every goal achieved (one of them paused): 'All goals achieved. 🎉' as before", () => {
    const p = projections(data([goal({ openingAmount: 1200 }), goal({ id: "g2", name: "Wedding gift", targetAmount: 300, openingAmount: 300, pausedAt: "2026-10-01T09:00:00.000Z" })]));
    expect(p).toContain("All goals achieved. 🎉");
    expect(p).not.toContain("Nothing left to plan");
  });
});

describe("unchanged", () => {
  it("a goal at or over its target is 'achieved!' and 100% on the Overview, as before", () => {
    const c = overviewCard(data([goal({ name: "New phone", targetAmount: 600, openingAmount: 650 })]), "New phone");
    expect(within(c).getByText("achieved!")).toBeTruthy();
    expect(text(c)).toContain("100%");
  });
  it("a target of 0 reads 100% (computeDashboard's convention)", () => {
    expect(computeDashboard(data([goal({ targetAmount: 0 })])).goals[0].projection.pctComplete).toBe(100);
  });
  it("an ordinary open goal keeps its rounded percent (12.6% reads 13%)", () => {
    expect(computeDashboard(data([goal({ targetAmount: 1000, openingAmount: 126 })])).goals[0].projection.pctComplete).toBe(13);
  });
});

describe("the plan's worked example: an account like the owner's, on 9 Nov 2026", () => {
  const d = data([
    goal({ id: "lap", openingAmount: 300 }),
    goal({ id: "kor", name: "South Korea", emoji: "✈️", targetAmount: 6000, targetDate: "2028-06-01" }),
    goal({ id: "pho", name: "Phone", emoji: "📱", targetAmount: 600, openingAmount: 400, targetDate: "2026-12-01", achievedAt: "2026-10-02" }),
    goal({ id: "wed", name: "Wedding gift", emoji: "🎁", targetAmount: 300, openingAmount: 300, pausedAt: "2026-10-01T09:00:00.000Z" }),
    goal({ id: "car", name: "Car service", emoji: "🚗", currency: "LBP", targetAmount: 45_000_000, openingAmount: 9_000_000, targetDate: "2027-02-01", achievedAt: "2026-10-02" }),
  ], [
    row("lap", "2026-08-10", 400), row("lap", "2026-09-12", 300), row("lap", "2026-10-05", 194),
    row("kor", "2026-07-25", 250), row("kor", "2026-08-25", 250), row("kor", "2026-09-25", 250), row("kor", "2026-10-25", 250),
    row("pho", "2026-10-02", 200, { deletedAt: "2026-10-20T09:00:00.000Z" }),
    row("car", "2026-09-03", 18_000_000, { currency: "LBP" }), row("car", "2026-09-28", 18_000_000, { currency: "LBP", createdAt: "2026-10-02T09:00:00.000Z" }),
  ]);

  it("Journey: 2 goals achieved (Car service and Wedding gift, not Phone)", () => {
    expect(journey(d)).toBe("2");
  });
  it("My Finances: Laptop 99%; Phone no badge; Car service dated 28/09/2026; Wedding gift Achieved and Paused", async () => {
    expect(text(await myFinancesRow(d, "Laptop"))).toContain("99%");
    expect(text(screen.getByText((_, el) => el?.tagName === "SPAN" && el.className.includes("truncate") && (el.textContent ?? "").endsWith("Phone")).closest("div.rounded-xl"))).not.toContain("Achieved");
    expect(text(screen.getByText((_, el) => el?.tagName === "SPAN" && el.className.includes("truncate") && (el.textContent ?? "").endsWith("Car service")).closest("div.rounded-xl"))).toContain("Achieved 28/09/2026");
    const wed = screen.getByText((_, el) => el?.tagName === "SPAN" && el.className.includes("truncate") && (el.textContent ?? "").endsWith("Wedding gift")).closest("div.rounded-xl") as HTMLElement;
    expect(within(wed).getByText("Achieved")).toBeTruthy();
  });
  it("Projections plans Laptop (99% saved)", () => {
    expect(projections(d)).toContain("99% saved");
  });
});
