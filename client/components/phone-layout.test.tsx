// Session 32 review, batch 2 (layout only, no text changes). At 390 px:
// - U3: the notices sat on the phone's bars -- the merge notice and InputPanel's toast on the bottom
//   navigation (the merge notice blocked it until dismissed), the save, sync-refused, too-large and
//   backup-failed notices over the top bar's account button. Below md they now clear the bars; md and up
//   keep their old places.
// - C1: a long Renewing-soon name pushed its "· $750.00" and "· tomorrow" apart from their dots.
// - C2: the foreign-cash sheet broke "−€18.00" across two lines.
// - C3: card labels broke mid-label ("Visa ••••" / "4821") in row meta lines.
// - U13: Setup's safety-net fields sat at different heights when one label wrapped.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "fs";
import path from "path";
import FinancialDashboard from "./FinancialDashboard";
import ForeignCashPanel from "./ForeignCashPanel";
import InputPanel from "./InputPanel";
import TransactionsScreen from "./screens/TransactionsScreen";
import SetupScreen from "./screens/SetupScreen";
import { ThemeProvider } from "../contexts/ThemeContext";
import { computeDashboard } from "../lib/computeDashboard";
import { buildExchange, buildForeignEntry } from "../lib/foreignCash";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-31T10:00:00")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const base = (over: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, ...over }) as LocalFinancials;
const onCard: Partial<StoredTransaction> = { paymentMethod: "card", cardId: "c1", cardLabel: "Visa •••• 4821" };

describe("U3: notices clear the phone's bars", () => {
  const src = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

  it("the merge notice and the action toast sit above the bottom navigation below md", () => {
    const merge = src("app/page.tsx").match(/\{mergeNotice && \(\s*<div\s+className="([^"]+)"/);
    const toast = src("components/InputPanel.tsx").match(/\{actionMsg && \(\s*<div\s+className="([^"]+)"/);
    // PWA P2 (2026-11-05): below md, the same 4.75rem plus the home indicator's inset (viewport-fit=cover).
    for (const [m, below] of [[merge, /(^| )bottom-\[calc\(4\.75rem\+env\(safe-area-inset-bottom\)\)\]( |$)/], [toast, /(^| )bottom-\[calc\(4\.75rem\+env\(safe-area-inset-bottom\)\)\]( |$)/]] as const) {
      expect(m).not.toBeNull();
      expect(m![1]).toMatch(below);
      expect(m![1]).toMatch(/(^| )md:bottom-4( |$)/);
    }
  });

  // Session 52 (owner, R8): the two backup notices left this rule. Below md they sit in the page's flow
  // (page.backup-dismiss.test.tsx pins that); the save error and the sync-refused notice stay fixed here.
  it("the top notices sit below the top bar below md, stacked under the save error as before", () => {
    const page = src("app/page.tsx");
    const save = page.match(/\{saveError && \(\s*<div\s+role="alert"\s+className="([^"]+)"/);
    expect(save).not.toBeNull();
    // PWA P2 (2026-11-05): below md, the same offsets plus the notch/status bar's inset (viewport-fit=cover).
    expect(save![1]).toMatch(/(^| )top-\[calc\(4\.5rem\+env\(safe-area-inset-top\)\)\]( |$)/);
    expect(save![1]).toMatch(/(^| )md:top-4( |$)/);
    const refusedAt = page.search(/\{syncRefused && \(/);
    expect(refusedAt).toBeGreaterThan(-1);
    const refused = page.slice(refusedAt, refusedAt + 600);
    expect(refused).toMatch(/saveError \? "top-\[calc\(11rem\+env\(safe-area-inset-top\)\)\] md:top-\[7\.5rem\]" : "top-\[calc\(4\.5rem\+env\(safe-area-inset-top\)\)\] md:top-4"/);
    expect(refused).not.toMatch(/top: saveError/);
  });

  it("the two backup notices share one placement: stacked under a save error, else in the flow below md, fixed from md", () => {
    const page = src("app/page.tsx");
    const place = page.match(/const backupNoticePlace = `([^`]+)`/);
    expect(place).not.toBeNull();
    // With a save error showing too, the phone keeps the old stacked, fixed position under it.
    expect(place![1]).toMatch(/saveError \? "fixed top-\[calc\(11rem\+env\(safe-area-inset-top\)\)\] left-4 right-4 shadow-2xl z-50 md:top-\[7\.5rem\]"/);
    // Otherwise: in the flow below md (no "fixed" without the md: prefix), fixed at the top right from md.
    expect(place![1]).toMatch(/: "mx-4 mt-3 md:mx-0 md:mt-0 md:top-4"\} md:fixed md:left-auto md:right-4 md:max-w-md/);
    for (const name of ["backupTooLarge", "backupFailed"]) {
      // Session 33 (U3): the backup notice can be dismissed, so its condition gained "&& !backupNoticeDismissed".
      const at = page.search(new RegExp(`\\{${name}(?: && !\\w+)? && \\(`));
      expect(at, name).toBeGreaterThan(-1);
      expect(page.slice(at, at + 200), name).toMatch(/className=\{`\$\{backupNoticePlace\} /);
    }
  });
});

describe("C1: a Renewing-soon chip keeps each figure in one piece", () => {
  it("the amount and the due text don't break inside themselves", () => {
    const uni: StoredRecurring = { id: "r1", name: "University installment", emoji: "🎓", amount: 750, currency: "USD", frequency: "monthly", bucket: "NEEDS", category: "education", startDate: "2026-11-01", endDate: null, totalAmount: null, createdAt: "2026-10-01T00:00:00.000Z" }; // first due tomorrow, nothing overdue
    const d = base({ recurring: [uni] });
    render(<FinancialDashboard data={computeDashboard(d)} financials={d} onConfirmRecurring={vi.fn()} />);
    const amount = screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "· $750.00");
    const due = screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "· tomorrow");
    expect(amount.className).toMatch(/whitespace-nowrap/);
    expect(due.className).toMatch(/whitespace-nowrap/);
  });
});

describe("C2: the foreign-cash sheet keeps its amounts in one piece", () => {
  it("the signed amount and the balance don't break", () => {
    const ex = buildExchange({ date: "2026-10-01", paid: 650, paidCurrency: "USD", from: { paymentMethod: "cash" }, code: "EUR", received: 600, description: "Euros for Paris" }, 89500);
    const spend = buildForeignEntry({ kind: "spend", code: "EUR", amount: 18, date: "2026-10-02", description: "Café de Flore" });
    render(<ThemeProvider><ForeignCashPanel financials={base({ transactions: [ex], foreignEntries: [spend] })} onChange={vi.fn()} /></ThemeProvider>);
    const signed = screen.getByText("−€18.00");
    const balance = screen.getByText("€582.00");
    expect(signed.className).toMatch(/whitespace-nowrap/);
    expect(balance.className).toMatch(/whitespace-nowrap/);
  });
});

describe("C3: a card label stays on one line in row meta", () => {
  const row: StoredTransaction = { id: "t1", amount: 20.6, currency: "USD", bucket: "NEEDS", category: "groceries", description: "Mini market", date: "2026-10-30", ...onCard } as StoredTransaction;

  it("Transactions", () => {
    render(<TransactionsScreen financials={base({ transactions: [row] })} onChange={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText("Visa •••• 4821").className).toMatch(/whitespace-nowrap/);
  });

  it("My Finances", () => {
    const d = base({ transactions: [row] });
    render(<InputPanel financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
    expect(screen.getByText("Visa •••• 4821").className).toMatch(/whitespace-nowrap/);
  });
});

describe("U13: Setup's safety-net fields line up", () => {
  it("the two-column grid aligns its fields at the bottom", () => {
    const d = base();
    render(<SetupScreen financials={d} dashData={computeDashboard(d)} onChange={vi.fn()} />);
    const grid = document.getElementById("ef-target-months")!.closest(".grid")!;
    expect(grid.className).toMatch(/(^| )items-end( |$)/);
  });
});
