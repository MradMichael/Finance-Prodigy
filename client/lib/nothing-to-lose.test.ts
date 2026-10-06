// SYNC-1 step 1 (DI-09, 2026-10-06): the "nothing to lose" check.
//
// isEmptyFinancials decides when ESSA may replace this device's data without
// asking: Restore from database and recovery (through hasRealLocalData and
// confirmOverwriteIfNeeded, 2.4.37), and the one-time first-load pull. It
// checked income, the emergency fund and seven lists, and ignored four
// collections the owner fills in by hand: the wishlist, custom categories,
// category rules and period closes. In Stage 1's reproduction, a laptop
// holding only wishlist items pressed Restore, no confirm appeared, and
// "Cobalt kettle" ($41.60) was gone from every device.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_DATA, isEmptyFinancials, migrateFinancials, saveData,
  type LocalFinancials, type PeriodClose,
} from "./localData";
import { confirmOverwriteIfNeeded } from "./syncService";
import { activateSessionKey } from "./crypto";

const KETTLE = {
  id: "w1", name: "Cobalt kettle", emoji: "🫖", price: 41.6, currency: "USD" as const,
  priority: "medium" as const, createdAt: "2026-10-06T17:40:12.000Z",
};
// Only its presence matters to this check; a real close carries many more fields.
const CLOSE = { cycleKey: "2026-08", rangeStart: "2026-08-27", rangeEnd: "2026-09-26" } as unknown as PeriodClose;

const ONLY: [string, Partial<LocalFinancials>][] = [
  ["a wishlist item", { wishlist: [KETTLE] }],
  ["a custom category", { customCategories: [{ value: "pharmacy", label: "Pharmacy", icon: "💊" }] }],
  ["a category rule", { categoryRules: [{ id: "r1", keyword: "Spinneys", category: "groceries" }] }],
  ["a period close", { periodCloses: [CLOSE] }],
];

describe("isEmptyFinancials", () => {
  it("a brand-new account is still empty, so a new device still restores itself on first load", () => {
    // Premise for every case below: these collections start empty, and the
    // migration seeds none of them.
    expect(isEmptyFinancials(DEFAULT_DATA)).toBe(true);
    expect(isEmptyFinancials(migrateFinancials({}))).toBe(true);
  });

  it.each(ONLY)("an account holding only %s has something to lose", (_label, extra) => {
    expect(isEmptyFinancials({ ...DEFAULT_DATA, ...extra })).toBe(false);
  });

  it("a record from before a collection existed (the field absent) is still read safely", () => {
    const { wishlist: _w, customCategories: _c, categoryRules: _r, periodCloses: _p, ...older } = DEFAULT_DATA;
    expect(isEmptyFinancials(older as LocalFinancials)).toBe(true);
  });
});

describe("Restore asks before replacing them (confirmOverwriteIfNeeded, 2.4.37)", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); activateSessionKey(new Uint8Array(32).fill(9)); });
  afterEach(() => vi.restoreAllMocks());

  it.each(ONLY)("a device holding only %s is asked, and declining keeps it", async (_label, extra) => {
    await saveData({ ...DEFAULT_DATA, ...extra } as LocalFinancials, "u1");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(await confirmOverwriteIfNeeded("u1", "what's on the server")).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("the control: a truly empty device is not asked", async () => {
    await saveData({ ...DEFAULT_DATA } as LocalFinancials, "u1");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(await confirmOverwriteIfNeeded("u1", "what's on the server")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
