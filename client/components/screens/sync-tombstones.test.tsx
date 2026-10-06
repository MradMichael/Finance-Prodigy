// SYNC-1 step 2 (DI-08, 2026-10-06): what the screens write so a merge can
// tell a deletion from an item the other device never had, and an older edit
// from a newer one.
//
// Every edit of a wishlist item, custom category or category rule stamps
// `updatedAt`. Every deletion, including of a tracked balance, removes the
// item as before AND records its key in `deletedKeys`. Without that record, a
// merge's union would bring the item back from the other device: Phase 2.7's
// reason for not merging these lists at all.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import WishlistScreen from "./WishlistScreen";
import CategoriesScreen from "./CategoriesScreen";
import BalanceCheckScreen from "./BalanceCheckScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type WishlistItem } from "../../lib/localData";

const NOW = new Date("2026-10-06T19:40:00.000Z");
const KETTLE: WishlistItem = {
  id: "w3", name: "Cobalt kettle", emoji: "🫖", price: 41.6, currency: "USD", priority: "medium",
  createdAt: "2026-10-06T17:19:50.000Z", updatedAt: "2026-10-06T17:19:50.000Z",
};
const base = (extra: Partial<LocalFinancials>) => ({ ...DEFAULT_DATA, income: 3150.75, ...extra }) as LocalFinancials;

let onChange: ReturnType<typeof vi.fn<(d: LocalFinancials) => void>>;
const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][0] as LocalFinancials;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  onChange = vi.fn<(d: LocalFinancials) => void>();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("wishlist", () => {
  const show = (d: LocalFinancials) => render(<ThemeProvider><WishlistScreen financials={d} onChange={onChange} /></ThemeProvider>);

  it("adding stamps updatedAt", () => {
    show(base({ wishlist: [] }));
    fireEvent.change(document.getElementById("wish-name")!, { target: { value: "Amber stool" } });
    fireEvent.change(document.getElementById("wish-price")!, { target: { value: "22.15" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
    expect(last().wishlist?.[0].updatedAt).toBe(NOW.toISOString());
  });

  it("marking bought stamps updatedAt", () => {
    show(base({ wishlist: [KETTLE] }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as bought" }));
    expect(last().wishlist?.[0].updatedAt).toBe(NOW.toISOString());
  });

  it("deleting removes the item and records the deletion", () => {
    show(base({ wishlist: [KETTLE] }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Cobalt kettle from wishlist" }));
    expect(last().wishlist).toEqual([]);
    expect(last().deletedKeys?.wishlist).toEqual([{ key: "w3", deletedAt: NOW.toISOString() }]);
  });
});

describe("categories and rules", () => {
  const pharmacy = { value: "pharmacy", label: "Pharmacy", icon: "💊", updatedAt: "2026-10-05T10:00:00.000Z" };
  const rule = { id: "r1", keyword: "Spinneys", category: "groceries", updatedAt: "2026-10-05T10:00:00.000Z" };
  const show = (d: LocalFinancials) => render(<ThemeProvider><CategoriesScreen financials={d} onChange={onChange} /></ThemeProvider>);

  it("adding a category stamps updatedAt", () => {
    show(base({ customCategories: [] }));
    fireEvent.change(document.getElementById("new-cat-name")!, { target: { value: "Pet care" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
    expect(last().customCategories?.[0].updatedAt).toBe(NOW.toISOString());
  });

  it("renaming a category stamps updatedAt", () => {
    show(base({ customCategories: [pharmacy] }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Pharmacy category" }));
    fireEvent.change(document.getElementById("edit-cat-name")!, { target: { value: "Pharmacy & clinic" } });
    fireEvent.keyDown(document.getElementById("edit-cat-name")!, { key: "Enter" });
    expect(last().customCategories?.[0]).toMatchObject({ label: "Pharmacy & clinic", updatedAt: NOW.toISOString() });
  });

  it("deleting a category records the deletion under its value", () => {
    show(base({ customCategories: [pharmacy] }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Pharmacy category" }));
    expect(last().customCategories).toEqual([]);
    expect(last().deletedKeys?.customCategories).toEqual([{ key: "pharmacy", deletedAt: NOW.toISOString() }]);
  });

  it("adding a rule stamps updatedAt", () => {
    show(base({ categoryRules: [] }));
    fireEvent.change(document.getElementById("rule-keyword")!, { target: { value: "Spinneys" } });
    fireEvent.change(document.getElementById("rule-category")!, { target: { value: "groceries" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add rule" }));
    expect(last().categoryRules?.[0].updatedAt).toBe(NOW.toISOString());
  });

  it("deleting a rule records the deletion under its id", () => {
    show(base({ categoryRules: [rule] }));
    fireEvent.click(screen.getByRole("button", { name: "Delete rule for Spinneys" }));
    expect(last().categoryRules).toEqual([]);
    expect(last().deletedKeys?.categoryRules).toEqual([{ key: "r1", deletedAt: NOW.toISOString() }]);
  });
});

describe("tracked balances", () => {
  it("removing one records the deletion", () => {
    const cash = { id: "tb-cash", name: "Wallet cash", paymentMethod: "cash" as const, startingBalance: 412.35, startingDate: "2026-08-01", currency: "USD" as const };
    const d = base({ trackedBalances: [cash] });
    render(<ThemeProvider><BalanceCheckScreen financials={d} dashData={computeDashboard(d)} onChange={onChange} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(last().trackedBalances).toEqual([]);
    expect(last().deletedKeys?.trackedBalances).toEqual([{ key: "tb-cash", deletedAt: NOW.toISOString() }]);
  });
});
