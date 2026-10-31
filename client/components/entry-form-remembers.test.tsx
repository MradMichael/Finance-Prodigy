// Owner, session 33 (DECISIONS_PENDING 14, 20, 21; wording approved):
// - U5: the entry form starts with the last currency and payment method logged on this device;
// - U4: "Logged {name}, {amount}." after an entry is logged (the reminder's approved text);
// - T9: a category's usual type is picked unless you picked one yourself; custom categories choose it
//   with "Usually".
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import InputPanel from "./InputPanel";
import CategoriesScreen from "./screens/CategoriesScreen";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredCard } from "../lib/localData";
import type { Session } from "../lib/auth";

const KEY = "essa_entry_last_u1";
const session: Session = { userId: "u1", email: "quartz@example.invalid", name: "Quartz Nine" };
const visa: StoredCard = { id: "c1", type: "Visa", last4: "4821", label: "Visa •••• 4821" };
const base = (over: Partial<LocalFinancials> = {}) => ({
  ...DEFAULT_DATA, income: 3000, cards: [visa],
  customCategories: [{ value: "coffee", label: "Coffee", icon: "☕", usualBucket: "WANTS" }],
  categoryRules: [{ id: "r1", keyword: "Charcoal", category: "coffee" }],
  ...over,
}) as LocalFinancials;

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); });

function panel(d = base(), onChange = vi.fn()) {
  render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={onChange} session={session} onEdit={vi.fn()} onPay={vi.fn()} />);
  return onChange;
}
const pressed = (name: string) => screen.getAllByRole("button").filter((b) => b.textContent?.trim().endsWith(name) && b.textContent.length < 24).some((b) => b.getAttribute("aria-pressed") === "true");
const tile = (name: string) => screen.getAllByRole("button").find((b) => b.textContent?.trim().endsWith(name) && b.textContent.length < 20)!;
const amount = () => document.getElementById("tx-amount") as HTMLInputElement;
const desc = () => document.getElementById("tx-desc") as HTMLInputElement;
const add = () => fireEvent.click(screen.getByRole("button", { name: "+ Add entry" }));

describe("U5: the form remembers the last currency and payment method on this device", () => {
  it("opens on what was last logged", () => {
    localStorage.setItem(KEY, JSON.stringify({ currency: "LBP", paymentMethod: "card", cardId: "c1" }));
    panel();
    expect(pressed("L£ LBP")).toBe(true);
    expect(pressed("Card")).toBe(true);
    expect(screen.getByRole("button", { name: "Visa •••• 4821" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back when nothing is stored, or the card is gone", () => {
    panel();
    expect(pressed("$ USD")).toBe(true);
    expect(pressed("Cash")).toBe(true);
    cleanup();
    localStorage.setItem(KEY, JSON.stringify({ currency: "LBP", paymentMethod: "card", cardId: "gone" }));
    panel();
    expect(pressed("L£ LBP")).toBe(true);
    expect(pressed("Cash")).toBe(true);
  });

  it("is written when an entry is logged, and never into the account's data", () => {
    const onChange = panel();
    fireEvent.click(screen.getByRole("button", { name: "L£ LBP" }));
    fireEvent.change(amount(), { target: { value: "250000" } });
    fireEvent.change(desc(), { target: { value: "Bakery" } });
    add();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ currency: "LBP", paymentMethod: "cash" });
    const saved = onChange.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(JSON.stringify(saved)).not.toContain("essa_entry_last");
    expect(Object.keys(saved).some((k) => /entry.?last|remember/i.test(k))).toBe(false);
  });
});

describe("U4: 'Logged …' after an entry", () => {
  it("names the entry and its amount in its own currency", () => {
    panel();
    fireEvent.change(amount(), { target: { value: "12.5" } });
    fireEvent.change(desc(), { target: { value: "Bakery" } });
    add();
    expect(screen.getByText(/Logged Bakery, \$12\.50\./)).toBeTruthy();
  });

  it("a split entry shows both amounts", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Split across USD and LBP?" }));
    fireEvent.change(document.getElementById("tx-split-usd") as HTMLInputElement, { target: { value: "5" } });
    fireEvent.change(document.getElementById("tx-split-lbp") as HTMLInputElement, { target: { value: "450000" } });
    fireEvent.change(desc(), { target: { value: "Fuel" } });
    add();
    expect(screen.getByText(/Logged Fuel, \$5\.00 \+ L£450,000\./)).toBeTruthy();
  });
});

describe("T9: a category's usual type", () => {
  it("a chosen built-in category picks its type", () => {
    panel();
    expect(pressed("Needs")).toBe(true);
    fireEvent.change(document.getElementById("tx-category") as HTMLSelectElement, { target: { value: "dining" } });
    expect(pressed("Wants")).toBe(true);
  });

  it("a rule's category, from the description, picks its type", () => {
    panel();
    fireEvent.change(desc(), { target: { value: "Charcoal latte" } });
    expect(pressed("Wants")).toBe(true);
  });

  it("a type you pick wins for this entry; the next entry follows its category again", () => {
    panel();
    fireEvent.click(tile("Needs"));
    fireEvent.change(document.getElementById("tx-category") as HTMLSelectElement, { target: { value: "dining" } });
    expect(pressed("Needs")).toBe(true);
    fireEvent.change(amount(), { target: { value: "20" } });
    add();
    fireEvent.change(document.getElementById("tx-category") as HTMLSelectElement, { target: { value: "dining" } });
    expect(pressed("Wants")).toBe(true);
  });

  it("the Categories screen stores and clears a custom category's 'Usually'", () => {
    const onChange = vi.fn();
    const d = base({ customCategories: [] });
    render(<CategoriesScreen financials={d} onChange={onChange} />);
    fireEvent.change(document.getElementById("new-cat-name") as HTMLInputElement, { target: { value: "Pet care" } });
    fireEvent.change(screen.getByLabelText("Usually") as HTMLSelectElement, { target: { value: "NEEDS" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
    const added = (onChange.mock.calls.at(-1)![0] as LocalFinancials).customCategories!.at(-1)!;
    expect(added.label).toBe("Pet care");
    expect(added.usualBucket).toBe("NEEDS");
    cleanup();
    const onChange2 = vi.fn();
    render(<CategoriesScreen financials={base()} onChange={onChange2} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Coffee category" }));
    const edit = document.getElementById("edit-cat-usual") as HTMLSelectElement; // the add form has its own "Usually"
    expect(document.querySelector('label[for="edit-cat-usual"]')!.textContent).toBe("Usually");
    expect(edit.value).toBe("WANTS");
    fireEvent.change(edit, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onChange2.mock.calls.at(-1)![0] as LocalFinancials).customCategories![0].usualBucket).toBeUndefined();
  });
});
