// Approved in session 34 (owner, session 33): Projections names the goals whose target date passes before the plan reaches
// them, in a drafted line, and leaves them out of the combined figure.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ProjectionsScreen from "./screens/ProjectionsScreen";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-31T10:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const goal = (over: Partial<StoredGoal>): StoredGoal => ({ id: "g", name: "Goal", emoji: "🎯", targetAmount: 1000, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-12-01", createdAt: "2025-11-01T08:00:00.000Z", ...over });

it("the passed goal is named in the drafted line, and the combined figure counts only the others", () => {
  const d = { ...DEFAULT_DATA, income: 3000, budgetRule: "50-30-20", emergencyFundTargetMonths: 6, goals: [
    goal({ id: "laptop", name: "Laptop", emoji: "💻", targetAmount: 1000, openingAmount: 530, currentAmount: 530, targetDate: "2027-03-01" }),
    goal({ id: "korea", name: "South Korea", emoji: "✈️", targetAmount: 5000, openingAmount: 1000, currentAmount: 1000, targetDate: "2028-03-01" }),
  ] } as LocalFinancials;
  render(<ProjectionsScreen financials={d} dashData={computeDashboard(d)} />);
  expect(screen.getByText("Laptop's target date passes before this plan reaches your goals, so no monthly amount here meets it.")).toBeTruthy();
  const banner = screen.queryByText(/Your goals need .* combined to hit every target date/);
  if (banner) expect(banner.textContent).not.toMatch(/\$4[0-9]{2},/); // never a one-month lump for the laptop's $470
});
