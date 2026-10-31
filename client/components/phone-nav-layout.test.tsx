// Owner, session 33 (DECISIONS_PENDING 16, 24; "More" approved; no other new text):
// - U1: the phone's bar holds four screens and More, which lists them all;
// - U6: My Finances' This month list grows on a phone instead of scrolling inside the page;
// - U7: Trips lists the trips before the New trip form;
// - U10: My Finances' repeated brand block is gone;
// - T8: Transactions shows each entry's own currency first, a lira entry's dollars beneath.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import BottomNav from "./shell/BottomNav";
import InputPanel from "./InputPanel";
import TripsScreen from "./screens/TripsScreen";
import TransactionsScreen from "./screens/TransactionsScreen";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { NAV } from "./screens/shared";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "../lib/localData";
import type { StoredTrip } from "../lib/trips";

afterEach(cleanup);

describe("U1: the phone's bar", () => {
  const bar = (screenKey = "overview" as (typeof NAV)[number]["key"], setScreen = vi.fn()) => {
    render(<ThemeProvider><BottomNav screen={screenKey} setScreen={setScreen} /></ThemeProvider>);
    return setScreen;
  };
  const navButtons = () => within(document.querySelector("nav")!).getAllByRole("button");

  it("holds Overview, My Finances, Transactions, Goals and More", () => {
    bar();
    expect(navButtons().map((b) => b.textContent!.replace(/^\W+/u, ""))).toEqual(["Overview", "My Finances", "Transactions", "Goals", "More"]);
  });

  it("More lists every screen; choosing one goes there and closes the list", () => {
    const setScreen = bar();
    const more = screen.getByRole("button", { name: /More/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(within(panel).getAllByRole("button")).toHaveLength(NAV.length);
    fireEvent.click(within(panel).getByRole("button", { name: /Budget/ }));
    expect(setScreen).toHaveBeenCalledWith("budget");
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape and a tap outside close the list", () => {
    bar();
    const more = screen.getByRole("button", { name: /More/ });
    fireEvent.click(more);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    fireEvent.pointerDown(document.body);
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("More reads as current on a screen it holds; a fixed entry on its own", () => {
    bar("budget");
    expect(screen.getByRole("button", { name: /More/ }).getAttribute("aria-current")).toBe("page");
    cleanup();
    bar("goals");
    expect(navButtons().find((b) => /Goals/.test(b.textContent!))!.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /More/ }).getAttribute("aria-current")).toBeNull();
  });
});

const row = (id: string, over: Partial<StoredTransaction> = {}): StoredTransaction =>
  ({ id, amount: 12, currency: "USD", bucket: "NEEDS", category: "groceries", description: `Row ${id}`, date: "2026-10-20", paymentMethod: "cash", ...over }) as StoredTransaction;
const base = (over: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, ...over }) as LocalFinancials;

describe("U6 and U10: My Finances", () => {
  it("This month grows on a phone and keeps its box from md up", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-25T12:00:00"));
    const d = base({ transactions: Array.from({ length: 8 }, (_, i) => row(`t${i}`)) });
    render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
    const list = screen.getByText("Row t0").closest('[class*="space-y-2"]') as HTMLElement;
    const classes = list.className.split(/\s+/);
    expect(classes).toContain("md:max-h-72");
    expect(classes).toContain("md:overflow-y-auto");
    expect(classes).not.toContain("max-h-72");
    expect(classes).not.toContain("overflow-y-auto");
    vi.useRealTimers();
  });

  it("the repeated brand block is gone", () => {
    const d = base();
    render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} session={{ userId: "u1", email: "a@example.invalid", name: "Quartz Nine" }} onEdit={vi.fn()} onPay={vi.fn()} />);
    expect(screen.queryByText("Earn · Spend · Save · Achieve")).toBeNull();
    expect(screen.queryByText(/Quartz Nine.s finances/)).toBeNull();
  });
});

describe("U7: Trips before the New trip form", () => {
  it("the first trip comes before the form", () => {
    const trip: StoredTrip = { id: "p", name: "Paris", startDate: "2026-04-10", endDate: "2026-04-17", budgetUSD: 1800, createdAt: "2026-02-20T00:00:00.000Z", updatedAt: "2026-02-20T00:00:00.000Z" };
    render(<ThemeProvider><TripsScreen financials={base({ trips: [trip] })} onChange={vi.fn()} /></ThemeProvider>);
    const heading = screen.getByRole("heading", { name: "Paris" });
    const form = screen.getByRole("form", { name: "New trip" });
    expect(heading.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("T8: Transactions shows the entry's own currency first", () => {
  it("a lira row: the lira, then its dollars", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-25T12:00:00"));
    const lira = row("l", { amount: 790000, currency: "LBP", lbpRateAtEntry: 89500 });
    render(<TransactionsScreen financials={base({ transactions: [lira] })} onChange={vi.fn()} onEdit={vi.fn()} />);
    const lines = Array.from(screen.getByText("L£790,000").parentElement!.querySelectorAll("p")).map((p) => p.textContent);
    expect(lines).toEqual(["L£790,000", "$8.83"]);
    vi.useRealTimers();
  });

  it("a dollar row: the dollars alone", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-25T12:00:00"));
    render(<TransactionsScreen financials={base({ transactions: [row("u", { amount: 21.79 })] })} onChange={vi.fn()} onEdit={vi.fn()} />);
    const lines = Array.from(screen.getByText("$21.79").parentElement!.querySelectorAll("p")).map((p) => p.textContent);
    expect(lines).toEqual(["$21.79"]);
    vi.useRealTimers();
  });
});
