// 2.4.105: the monthly-snapshot effect must not record a zero income.
//
// Clearing the income field sets income to 0 (`parseFloat("") || 0`). Within
// a cycle that transient is harmless -- the next keystroke overwrites the
// same key. Across a boundary it is not: clear on the last day of cycle N,
// retype on the first day of N+1, and N keeps a permanent 0 that
// valueForMonth then feeds to that period's rollover, streak and trend.
//
// A genuine zero and a transient one are BYTE-IDENTICAL here -- same value,
// same code path, no marker. So this does not distinguish them; it declines
// to record either. That is consistent with every other consumer, which
// already reads 0 as "unconfigured" rather than as an income level: Setup
// renders "Set your monthly income to unlock the dashboard", incomeSafe
// floors it at 1 before any division, and the savings-streak comment
// explicitly bundles "between jobs" with "not yet re-entered after a reset".
//
// The trade is asserted, not assumed -- see the inheritance test at the
// bottom. A genuinely zero cycle inherits the prior figure. That is wrong,
// and it is the wrongness the app has already chosen everywhere else.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { currentCycleKey } from "../lib/period";
import { cycleStartDayOf, valueForMonth, type LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };

vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { replace: vi.fn(), push: vi.fn() };

vi.mock("../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(),
}));

let seed: LocalFinancials;
const saved: LocalFinancials[] = [];
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return {
    ...actual,
    loadData: vi.fn(async () => seed),
    saveData: vi.fn(async (d: LocalFinancials) => { saved.push(d); }),
  };
});

vi.mock("../lib/syncService", () => ({
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  pushToServer: vi.fn(async () => ({ ok: true })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "" }),
  hasAutoPulled: vi.fn(() => true),
  markAutoPulled: vi.fn(),
  getLastSyncTime: () => null,
}));

import Home from "./page";
import { DEFAULT_DATA } from "../lib/localData";

const CYCLE = currentCycleKey(new Date(), cycleStartDayOf({}));

beforeEach(() => { localStorage.clear(); saved.length = 0; });

/** Render, wait for the app to settle, and return every persisted record. */
async function settle() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1200));
  return saved;
}

/** The incomeHistory entry for the current cycle across all writes, last wins. */
function incomeEntry() {
  for (let i = saved.length - 1; i >= 0; i--) {
    const e = (saved[i].incomeHistory ?? []).find((x) => x.ym === CYCLE);
    if (e) return e;
  }
  return undefined;
}

describe("4. THE BOUNDARY CASE — a transient zero must not overwrite a good entry", () => {
  it("a cycle already recorded at 3000 keeps 3000 while income sits at 0", async () => {
    // This IS 2.4.105's damage mechanism in one render: the effect writes
    // the CURRENT cycle's key, so a zero held while that cycle is open
    // replaces the figure that cycle will keep forever once it closes.
    seed = { ...DEFAULT_DATA, income: 0,
      incomeHistory: [{ ym: CYCLE, value: 3000 }] } as LocalFinancials;
    await settle();
    // Premise: the effect ran at all for this fixture, so "3000 survived"
    // is not "nothing happened". netWorthHistory is written unconditionally.
    expect(saved.length).toBeGreaterThan(0);
    expect(saved[saved.length - 1].netWorthHistory?.length).toBeGreaterThan(0);
    // The fix: the 0 was never recorded, so the real figure stands.
    expect(incomeEntry()?.value).toBe(3000);
  });

  it("and no zero entry is created for a cycle that had none", async () => {
    seed = { ...DEFAULT_DATA, income: 0, incomeHistory: [] } as LocalFinancials;
    await settle();
    expect(saved.length).toBeGreaterThan(0);
    expect(incomeEntry()).toBeUndefined();
  });
});

describe("5. THE TRADE, asserted so it is chosen rather than discovered", () => {
  it("a cycle with no entry inherits the most recent earlier figure — including a genuinely zero one", () => {
    // Declining to record zero means a genuinely income-less cycle reads as
    // whatever came before it. valueForMonth scans for the greatest
    // h.ym <= ym, so an ABSENT entry is not a gap -- it resolves backwards.
    //
    // This is the cost of Option A, written down on purpose. It is wrong in
    // the same direction the app is already wrong everywhere else (0 is read
    // as unconfigured, not as an income level), which is why it was accepted
    // -- not because it is harmless.
    const history = [
      { ym: "2026-06", value: 3000 },
      { ym: "2026-07", value: 3200 },
    ] as Parameters<typeof valueForMonth>[0];
    // 2026-08 has no entry: a cycle the user earned nothing in and which,
    // under this fix, records nothing.
    expect(valueForMonth(history, "2026-08" as never, 999)).toBe(3200);
    // The fallback is reached ONLY when nothing at or before the key exists.
    expect(valueForMonth(history, "2026-05" as never, 999)).toBe(999);
  });
});

describe("1-3. scope of the skip", () => {
  it("income 0 skips ONLY income — the other three histories still record", async () => {
    seed = { ...DEFAULT_DATA, income: 0, lbpRate: 89_500 } as LocalFinancials;
    await settle();
    const last = saved[saved.length - 1];
    expect(last.netWorthHistory?.length).toBeGreaterThan(0);
    expect(last.lbpRateHistory?.some((e) => e.ym === CYCLE)).toBe(true);
    expect(last.budgetRuleHistory?.some((e) => e.ym === CYCLE)).toBe(true);
    expect(last.incomeHistory?.some((e) => e.ym === CYCLE)).toBe(false);
  });

  it("a non-zero income records normally — the control", async () => {
    seed = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
    await settle();
    // Premise for every "no entry" assertion above: this fixture shape DOES
    // produce an income entry when the value is non-zero, so absence above
    // is the skip and not an effect that never ran.
    expect(incomeEntry()?.value).toBe(3000);
  });

  it("an existing entry is left intact, not deleted", async () => {
    // The skip must be a refusal to write, never a removal -- a cycle's real
    // recorded income must survive the user clearing the field.
    seed = { ...DEFAULT_DATA, income: 0,
      incomeHistory: [{ ym: "2026-01", value: 2400 }, { ym: CYCLE, value: 3000 }] } as LocalFinancials;
    await settle();
    const last = saved[saved.length - 1];
    expect(last.incomeHistory?.find((e) => e.ym === "2026-01")?.value).toBe(2400);
    expect(last.incomeHistory?.find((e) => e.ym === CYCLE)?.value).toBe(3000);
  });
});
