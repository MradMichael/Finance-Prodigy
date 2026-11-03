// Owner, session 35: a goal whose target date has passed before the plan reaches it no longer shows "Needs $X/mo
// more to hit its own target date at this priority." (the approved line above says no monthly amount meets it).
// Every other goal keeps the line. No new words.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ProjectionsScreen from "./screens/ProjectionsScreen";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-31T10:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const goal = (over: Partial<StoredGoal>): StoredGoal => ({ id: "g", name: "Goal", emoji: "🎯", targetAmount: 1000, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-12-01", createdAt: "2025-11-01T08:00:00.000Z", ...over });
const rowOf = (name: string) =>
  [...document.querySelectorAll("div.rounded-xl")].find((el) => el.textContent!.includes(name) && /saved · target/.test(el.textContent!))!.textContent!;

it("the passed goal has no \"Needs …\" line; an underfunded goal still in reach keeps it", () => {
  const d = { ...DEFAULT_DATA, income: 3000, budgetRule: "50-30-20", emergencyFundTargetMonths: 6, goals: [
    // Passed, and more left ($4,470) than the plan gives goals in a month: on main it showed a "Needs …" line.
    goal({ id: "laptop", name: "Laptop", emoji: "💻", targetAmount: 5000, openingAmount: 530, currentAmount: 530, targetDate: "2027-03-01" }),
    goal({ id: "car", name: "New car", emoji: "🚗", targetAmount: 90000, openingAmount: 0, currentAmount: 0, targetDate: "2034-01-01" }),
  ] } as LocalFinancials;
  render(<ProjectionsScreen financials={d} dashData={computeDashboard(d)} />);
  expect(screen.getByText(/^Laptop's target date passes before this plan reaches your goals/)).toBeTruthy(); // Laptop has passed
  expect(rowOf("Laptop")).not.toMatch(/Needs \$[\d,]+\/mo more/);
  expect(rowOf("New car")).toMatch(/Needs \$[\d,]+\/mo more to hit its own target date at this priority\./);
});
