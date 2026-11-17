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
  // (page.backup-dismiss.test.tsx pins that). Session 53 (owner): the save error joined them. Session 54 (owner):
  // the sync-refused notice too; it takes the backup notices' placement. Nothing in this group is pinned below md.
  it("the save error and the sync-refused notice are in the flow below md and fixed from md", () => {
    const page = src("app/page.tsx");
    const save = page.match(/\{saveError && \(\s*<div\s+role="alert"\s+className="([^"]+)"/);
    expect(save).not.toBeNull();
    expect(save![1]).not.toMatch(/(^| )fixed( |$)/);
    expect(save![1]).not.toMatch(/(^| )top-/);
    expect(save![1]).toMatch(/(^| )md:fixed( |$)/);
    expect(save![1]).toMatch(/(^| )md:top-4( |$)/);
    const refusedAt = page.search(/\{syncRefused && \(/);
    expect(refusedAt).toBeGreaterThan(-1);
    const refused = page.slice(refusedAt, refusedAt + 200);
    expect(refused).toMatch(/className=\{`\$\{backupNoticePlace\} /);
    expect(refused).not.toMatch(/(^|[\s"'`])(fixed|top-)/);
  });

  it("the two backup notices share one placement: in the flow below md, fixed from md, stacked under a save error there", () => {
    const page = src("app/page.tsx");
    const place = page.match(/const backupNoticePlace = `([^`]+)`/);
    expect(place).not.toBeNull();
    // Session 53: in the flow below md whether or not a save error shows (no "fixed" or "top-" without md:).
    expect(place![1]).not.toMatch(/(^|[ "])fixed[ "]/);
    expect(place![1]).not.toMatch(/(^|[ "])top-/);
    expect(place![1]).toMatch(/^mx-4 mt-3 md:mx-0 md:mt-0 /);
    // From md (session 55): the notices' region is the fixed box at the top right, under the save error when one
    // shows, and a column, so two notices stack; a notice only drops its phone margins there.
    expect(place![1]).not.toMatch(/md:(fixed|top-|right-|left-)/);
    const stack = page.match(/<div role="status" className=\{`([^`]+)`\}>/);
    expect(stack).not.toBeNull();
    expect(stack![1]).toMatch(/^flex-shrink-0 md:fixed \$\{saveError \? "md:top-\[7\.5rem\]" : "md:top-4"\} md:right-4 md:max-w-md md:z-50 md:flex md:flex-col md:gap-3$/);
    for (const name of ["syncRefused", "backupTooLarge", "backupFailed"]) {
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
