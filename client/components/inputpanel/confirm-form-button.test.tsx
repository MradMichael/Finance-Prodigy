// TODO 132 (owner, session 66, item 1; AUDIT 2.4.179): the Confirm payment form's "Confirm" fits on a phone. At 390 px
// it was 44 px wide with its 56 px label, so the "m" sat outside the button. The cause: the form's row is a flex row (the
// date field, which takes the room, then "Confirm" and ✕), and globals.css gives every button a min-width floor (24 px,
// 44 on a touch screen). An explicit min-width replaces flexbox's own minimum, the label's width, so a squeezed button
// shrinks to the floor under its label. The button now doesn't shrink (`shrink-0`); the date field gives up the room.
// jsdom does no layout, so this pins the class; the live check measures the button against its label at 390 and 1280.
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import InputPanel from "../InputPanel";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 9, 15, 10, 0), toFake: ["Date"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

// Rent: September's cycle confirmed, October's due on the 20th.
const RENT: StoredRecurring = { id: "r-rent", name: "Rent", emoji: "•", amount: 100, currency: "USD", frequency: "monthly", bucket: "NEEDS",
  startDate: "2026-09-20", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" };
const PAID = { id: "t-sep", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-09-20", paymentMethod: "card",
  createdAt: "2026-09-20T09:00:00.000Z", recurringId: "r-rent", cycleDate: "2026-09-20" } as StoredTransaction;
const DATA = { ...DEFAULT_DATA, income: 3000, recurring: [RENT], transactions: [PAID] } as LocalFinancials;

it("the Confirm payment form's \"Confirm\" keeps its label's width (it doesn't shrink under it)", () => {
  render(<InputPanel financials={DATA} dashData={computeDashboard(DATA)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} onConfirmRecurring={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
  fireEvent.click(screen.getByRole("button", { name: /Recurring Payments/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm this Rent payment" }));
  const form = screen.getByText("Confirm payment").parentElement as HTMLElement;
  const confirm = within(form).getByRole("button", { name: "Confirm" });
  // The premise: it sits in a flex row beside the date field, which takes the room.
  expect(confirm.parentElement!.classList.contains("flex")).toBe(true);
  expect(confirm.classList.contains("shrink-0")).toBe(true);
});

// The live check after the first fix: "Confirm" fitted, but at 390 the row was then 341 px of content in 315, and the
// cancel ✕ sat outside it (the date field can't be narrower than about 213 px). So, as the form already does when an
// entry is found (session 64), the buttons wrap below the date field on a phone: the date field takes the whole row
// below 640 px (sm), and shares it from 640 px up.
it("on a phone, the date field takes the row and the buttons wrap below it; from 640 px up they share one row", () => {
  render(<InputPanel financials={DATA} dashData={computeDashboard(DATA)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} onConfirmRecurring={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
  fireEvent.click(screen.getByRole("button", { name: /Recurring Payments/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm this Rent payment" }));
  const form = screen.getByText("Confirm payment").parentElement as HTMLElement;
  const row = within(form).getByRole("button", { name: "Confirm" }).parentElement!;
  expect(row.classList.contains("flex-wrap")).toBe(true);
  const date = form.querySelector(`#confirm-date-${RENT.id}`)!.closest("div.basis-full") as HTMLElement | null;
  expect(date, "the date field's box takes the whole row on a phone").not.toBeNull();
  expect(date!.parentElement).toBe(row);
  expect(date!.classList.contains("sm:flex-1")).toBe(true);
});
