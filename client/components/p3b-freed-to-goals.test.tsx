// Approved in session 34 (owner, session 33, P3-B; wording drafted): when an obligation ends, its amount goes to goals in the
// plan by default; "Keep it out of the plan" keeps today's dates. The safety net and debt keep the amount set.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import ProjectionsScreen from "./screens/ProjectionsScreen";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction, type StoredGoal } from "../lib/localData";
import { settingValue } from "../lib/syncSeen";
import { unknownFieldsOf } from "../lib/syncMerge";
import fs from "fs";
import path from "path";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-31T10:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const uni: StoredRecurring = { id: "uni", name: "University installment", emoji: "🎓", amount: 750, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-08-01", endDate: null, totalAmount: 6750, createdAt: "2026-08-01T00:00:00.000Z" };
const paid = (m: string): StoredTransaction => ({ id: `u${m}`, amount: 750, currency: "USD", bucket: "NEEDS", description: "University installment", date: `2026-${m}-01`, paymentMethod: "cash", recurringId: "uni", cycleDate: `2026-${m}-01` });
const car: StoredGoal = { id: "car", name: "New car", emoji: "🚗", targetAmount: 30000, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2029-06-30", createdAt: "2025-11-01T08:00:00.000Z" };
const data = (over: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3200, budgetRule: "50-30-20", emergencyFundTargetMonths: 1, emergencyFundBalance: 1600, emergencyFundOpeningBalance: 1600, recurring: [uni], transactions: ["08", "09", "10"].map(paid), goals: [car], ...over }) as LocalFinancials;
const carDate = () => screen.getAllByText(/New car/).map((el) => el.closest("div.rounded-xl")).find((el) => el && /target 30\/06\/2029/.test(el.textContent ?? ""))!.textContent!;

describe("freed money in the plan (drafted, held)", () => {
  it("by default the installment's $750 goes to goals from May 2027, so the car arrives sooner than with it kept out", () => {
    // The car needs about $940/mo for June 2029 and the plan gives goals $640: underfunded, so freed money
    // brings it forward. (A goal already funded at its required rate isn't sped up: each goal takes up to its
    // required rate, the closed form's rule, month by month.)
    const onChange = vi.fn();
    render(<ProjectionsScreen financials={data()} dashData={computeDashboard(data())} onChange={onChange} />);
    const withFreed = carDate();
    cleanup();
    const kept = data({ freedMoneyTo: "none" });
    render(<ProjectionsScreen financials={kept} dashData={computeDashboard(kept)} onChange={vi.fn()} />);
    const without = carDate();
    const months = (t: string) => Number(t.match(/\((\d+) mo\)/)![1]);
    expect(months(withFreed)).toBeLessThan(months(without));
  });

  it("the choice is stored, and the closing line says what happens", () => {
    const onChange = vi.fn();
    render(<ProjectionsScreen financials={data()} dashData={computeDashboard(data())} onChange={onChange} />);
    expect(screen.getByText("From each month above, what frees up goes to your goals in the plan below.")).toBeTruthy();
    const select = screen.getByLabelText("Freed money goes to") as HTMLSelectElement;
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Goals", "Keep it out of the plan"]);
    fireEvent.change(select, { target: { value: "none" } });
    expect((onChange.mock.calls.at(-1)![0] as LocalFinancials).freedMoneyTo).toBe("none");
  });

  it("with nothing finishing, there's no choice and no closing line (session 34, with P3-A's card)", () => {
    const d = data({ recurring: [], transactions: [] });
    render(<ProjectionsScreen financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} />);
    expect(screen.getByText(/Free after your commitments/)).toBeTruthy(); // the card is there (P3-A)
    expect(screen.queryByLabelText("Freed money goes to")).toBeNull();
    expect(screen.queryByText("From each month above, what frees up goes to your goals in the plan below.")).toBeNull();
  });

  it("the choice syncs with the budget setting, and is a field this code knows", () => {
    const kept = data({ freedMoneyTo: "none" });
    expect(settingValue(kept, "budget")).toMatchObject({ freedMoneyTo: "none" });
    expect(unknownFieldsOf(kept)).not.toHaveProperty("freedMoneyTo");
  });

  it("the page gives Projections its store, so the choice is saved", () => {
    const page = fs.readFileSync(path.join(__dirname, "../app/page.tsx"), "utf8");
    expect(page).toMatch(/<ProjectionsScreen [^>]*onChange=\{handleChange\}/);
  });
});
