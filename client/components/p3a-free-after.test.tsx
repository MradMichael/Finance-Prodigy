// Approved in session 34 (owner, session 33, DECISIONS_PENDING 25: P3-A, base = Setup income − recurring commitments; wording
// drafted): Projections' "Looking ahead" says what's free after your commitments, now and from each month an
// obligation ends. One committed-monthly total, shared with Recurring's.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ProjectionsScreen from "./screens/ProjectionsScreen";
import RecurringScreen from "./screens/RecurringScreen";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, committedMonthlyUSD, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-31T10:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const rent: StoredRecurring = { id: "rent", name: "Rent", emoji: "🏠", amount: 500, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2025-11-01", endDate: null, totalAmount: null, createdAt: "2025-11-01T00:00:00.000Z" };
const edl: StoredRecurring = { id: "edl", name: "EDL", emoji: "💡", amount: 2_237_500, currency: "LBP", frequency: "monthly", bucket: "NEEDS", startDate: "2025-11-20", endDate: null, totalAmount: null, createdAt: "2025-11-01T00:00:00.000Z" };
const uni: StoredRecurring = { id: "uni", name: "University installment", emoji: "🎓", amount: 750, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-08-01", endDate: null, totalAmount: 6750, createdAt: "2026-08-01T00:00:00.000Z" };
const paid = (m: string): StoredTransaction => ({ id: `u${m}`, amount: 750, currency: "USD", bucket: "NEEDS", description: "University installment", date: `2026-${m}-01`, paymentMethod: "cash", recurringId: "uni", cycleDate: `2026-${m}-01` });
const data = () => ({ ...DEFAULT_DATA, income: 3200, budgetRule: "50-30-20", recurring: [rent, edl, uni], transactions: ["08", "09", "10"].map(paid) }) as LocalFinancials;

describe("one committed-monthly total", () => {
  it("each active item's monthly cost, lira at today's rate", () => {
    expect(committedMonthlyUSD(data(), new Date())).toBeCloseTo(500 + 25 + 750, 6);
  });
  it("Recurring's total reads the same", () => {
    render(<RecurringScreen financials={data()} onEdit={vi.fn()} />);
    expect(screen.getByText("$1,275")).toBeTruthy();
  });
});

describe("free after your commitments (drafted, held)", () => {
  it("now, and from the month the installment ends", () => {
    const d = data();
    render(<ProjectionsScreen financials={d} dashData={computeDashboard(d)} />);
    expect(screen.getByText("Free after your commitments: $1,925/mo.")).toBeTruthy();
    expect(screen.getByText("$2,675/mo free from May 2027")).toBeTruthy();
    expect(screen.getByText("Your monthly income in Setup, less what your recurring items cost each month.")).toBeTruthy();
  });

  it("with two finishing, the in-total line counts only what they free, not the base", () => {
    const laptop: StoredRecurring = { id: "laptop", name: "Laptop plan", emoji: "💻", amount: 200, currency: "USD", frequency: "monthly", bucket: "WANTS", startDate: "2026-09-01", endDate: null, totalAmount: 1000, createdAt: "2026-09-01T00:00:00.000Z" };
    const laptopPaid = (m: string): StoredTransaction => ({ id: `l${m}`, amount: 200, currency: "USD", bucket: "WANTS", description: "Laptop plan", date: `2026-${m}-01`, paymentMethod: "cash", recurringId: "laptop", cycleDate: `2026-${m}-01` });
    const base = data();
    const d = { ...base, recurring: [...base.recurring, laptop], transactions: [...base.transactions, laptopPaid("09"), laptopPaid("10")] } as LocalFinancials;
    render(<ProjectionsScreen financials={d} dashData={computeDashboard(d)} />);
    expect(screen.getByText("Free after your commitments: $1,725/mo.")).toBeTruthy();
    expect(screen.getByText("$950/mo in total, once all of them have.")).toBeTruthy();
  });

  it("with no income, no figure", () => {
    const d = { ...data(), income: 0 } as LocalFinancials;
    render(<ProjectionsScreen financials={d} dashData={computeDashboard(d)} />);
    expect(screen.queryByText(/Free after your commitments/)).toBeNull();
  });
});
