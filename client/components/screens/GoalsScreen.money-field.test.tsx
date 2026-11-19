// D-f (owner, session 56): Goals' custom amount was a plain number box (step 1, no upper limit, no separators),
// where My Finances' "Add to this goal" uses the money field. It is now the money field (thousands separators, the
// goal currency's upper limit), and a lira goal's amount under L£500 asks first with the lira mistype check, as
// an entry does. Enter still pays; since Enter doesn't leave the field, the limit is applied there too: the field
// shows the limit and nothing is paid until Enter (or Pay) is pressed again. The quick amounts and the placeholder
// are unchanged.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import GoalsScreen from "./GoalsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, MONEY_MAX_USD, moneyMaxFor, lbpRateOf, type LocalFinancials, type StoredGoal } from "../../lib/localData";

afterEach(cleanup);

const goal = (id: string, name: string, currency: "USD" | "LBP", target: number): StoredGoal =>
  ({ id, name, emoji: "G", targetAmount: target, currentAmount: 0, openingAmount: 0, currency, targetDate: "2027-12-31", createdAt: "2026-06-01T00:00:00.000Z" });
const LAPTOP = goal("g-laptop", "Laptop", "USD", 1200);
const CAR = goal("g-car", "Car", "LBP", 900_000_000);
const DATA = { ...DEFAULT_DATA, income: 3000, goals: [LAPTOP, CAR], transactions: [] } as LocalFinancials;

function open(name: string) {
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><GoalsScreen dashData={computeDashboard(DATA)} financials={DATA} onChange={onChange} onEdit={vi.fn()} /></ThemeProvider>);
  const card = screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").includes(name) && el.className.includes("font-medium")).closest("div.rounded-2xl") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: /Add payment/ }));
  const box = within(card).getByPlaceholderText(/Custom amount/) as HTMLInputElement;
  const pay = within(card).getByRole("button", { name: "Pay" }) as HTMLButtonElement;
  const paid = () => onChange.mock.calls.map((c) => c[0].transactions[0]?.amount);
  return { card, box, pay, paid, onChange };
}
const type = (box: HTMLInputElement, v: string) => fireEvent.change(box, { target: { value: v } });
const enter = (box: HTMLInputElement) => fireEvent.keyDown(box, { key: "Enter" });

describe("the custom amount is the money field", () => {
  it("it is a text box with the decimal keypad, not a number box, and keeps its placeholder", () => {
    const { box } = open("Laptop");
    expect(box.type).toBe("text");
    expect(box.inputMode).toBe("decimal");
    expect(box.placeholder).toBe("Custom amount ($)");
  });

  it("a lira goal's placeholder names lira, as before", () => {
    expect(open("Car").box.placeholder).toBe("Custom amount (L£)");
  });

  it("L£1000000 shows its separators", () => {
    const { box } = open("Car");
    type(box, "1000000");
    fireEvent.blur(box);
    expect(box.value).toBe("1,000,000");
  });

  it("a figure above the goal currency's limit is brought down to it when the field is left", () => {
    const { box } = open("Laptop");
    type(box, String(MONEY_MAX_USD * 2));
    fireEvent.blur(box);
    expect(box.value).toBe(MONEY_MAX_USD.toLocaleString("en-US"));
  });

  it("a lira goal's limit is the lira one (the dollar limit at the account's rate)", () => {
    const { box } = open("Car");
    const max = moneyMaxFor("LBP", lbpRateOf(DATA));
    type(box, String(max * 2));
    fireEvent.blur(box);
    expect(box.value).toBe(max.toLocaleString("en-US"));
  });
});

describe("paying", () => {
  it("Enter still pays the typed amount", () => {
    const s = open("Laptop");
    type(s.box, "100");
    enter(s.box);
    expect(s.paid()).toEqual([100]);
  });

  it("Pay pays a figure typed with separators", () => {
    const s = open("Laptop");
    type(s.box, "1,250");
    fireEvent.click(s.pay);
    expect(s.paid()).toEqual([1250]);
  });

  it("Enter above the limit: the field shows the limit and nothing is paid; Enter again pays the limit", () => {
    const s = open("Laptop");
    type(s.box, String(MONEY_MAX_USD * 2));
    enter(s.box);
    expect(s.onChange).not.toHaveBeenCalled();
    expect(s.box.value).toBe(MONEY_MAX_USD.toLocaleString("en-US"));
    enter(s.box);
    expect(s.paid()).toEqual([MONEY_MAX_USD]);
  });

  it("a quick amount fills the field and is what Pay pays", () => {
    const s = open("Laptop");
    const chips = within(s.card).getAllByRole("button").filter((b) => /^\$[\d,]+(\.\d+)?$/.test(b.textContent ?? ""));
    expect(chips.length).toBeGreaterThan(0);
    const chip = chips[0];
    const figure = Number((chip.textContent ?? "").replace(/[$,]/g, ""));
    fireEvent.click(chip);
    expect(s.box.value).toBe(figure.toLocaleString("en-US"));
    expect(chip.style.border).toContain("solid");
    expect(chip.getAttribute("style")).not.toBe(chips[1]?.getAttribute("style") ?? "");
    fireEvent.click(s.pay);
    expect(s.paid()).toEqual([figure]);
  });

  it("Pay is disabled until there is an amount above 0", () => {
    const s = open("Laptop");
    expect(s.pay.disabled).toBe(true);
    type(s.box, "0");
    expect(s.pay.disabled).toBe(true);
    type(s.box, "5");
    expect(s.pay.disabled).toBe(false);
  });
});

describe("the lira mistype check", () => {
  it("a lira goal at L£400: it asks first, with the goal's words (item 3, session 57), and nothing is paid until the answer", () => {
    const s = open("Car");
    type(s.box, "400");
    fireEvent.click(s.pay);
    expect(screen.getByRole("dialog", { name: "Confirm low LBP amount" }).textContent).toContain("400 LBP is unusually low for a goal payment. Did you mean a larger amount?");
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it("\"Let me fix the amount\" closes it and pays nothing; the amount stays to fix", () => {
    const s = open("Car");
    type(s.box, "400");
    fireEvent.click(s.pay);
    fireEvent.click(screen.getByRole("button", { name: "Let me fix the amount" }));
    expect(screen.queryByRole("dialog", { name: "Confirm low LBP amount" })).toBeNull();
    expect(s.onChange).not.toHaveBeenCalled();
    expect(s.box.value).toBe("400");
  });

  it("\"No, save it as 400 LBP\" pays L£400 to the lira goal", () => {
    const s = open("Car");
    type(s.box, "400");
    fireEvent.click(s.pay);
    fireEvent.click(screen.getByRole("button", { name: "No, save it as 400 LBP" }));
    expect(s.paid()).toEqual([400]);
    expect(s.onChange.mock.calls[0][0].transactions[0]).toMatchObject({ goalId: "g-car", currency: "LBP" });
  });

  it("Enter asks too", () => {
    const s = open("Car");
    type(s.box, "400");
    enter(s.box);
    expect(screen.getByRole("dialog", { name: "Confirm low LBP amount" })).toBeTruthy();
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it("L£500 (the threshold) pays without asking", () => {
    const s = open("Car");
    type(s.box, "500");
    fireEvent.click(s.pay);
    expect(screen.queryByRole("dialog", { name: "Confirm low LBP amount" })).toBeNull();
    expect(s.paid()).toEqual([500]);
  });

  it("a dollar goal at $400 pays without asking", () => {
    const s = open("Laptop");
    type(s.box, "400");
    fireEvent.click(s.pay);
    expect(screen.queryByRole("dialog", { name: "Confirm low LBP amount" })).toBeNull();
    expect(s.paid()).toEqual([400]);
  });
});
