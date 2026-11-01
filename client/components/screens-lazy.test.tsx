// R3 (owner, session 33, DECISIONS_PENDING 23 (a)): the screens other than the Overview load on first use,
// and all of them are fetched once the browser is idle. This tests the lazy module itself; the page tests
// use its plain twin (screens.sync.tsx, through vitest.config.ts's alias).
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { WishlistScreen, CategoriesScreen, preloadScreens } from "../app/screens.lazy";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

afterEach(cleanup);
const data = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;

it("a screen not loaded yet renders nothing, then itself once its code arrives", async () => {
  const { container } = render(<ThemeProvider><WishlistScreen financials={data} onChange={vi.fn()} /></ThemeProvider>);
  expect(container.textContent).toBe("");
  expect(await screen.findByRole("heading", { name: "Wishlist" })).toBeTruthy();
});

it("after preloadScreens, a screen renders at once", async () => {
  await preloadScreens();
  render(<ThemeProvider><CategoriesScreen financials={data} onChange={vi.fn()} /></ThemeProvider>);
  expect(screen.getByRole("heading", { name: "Categories" })).toBeTruthy();
});

it("the page takes its screens from the lazy module and preloads them when idle", () => {
  const page = fs.readFileSync(path.join(__dirname, "../app/page.tsx"), "utf8");
  expect(page).toMatch(/from "\.\/screens\.lazy"/);
  expect(page).not.toMatch(/from "\.\.\/components\/screens\/(Budget|Statistics|Trips)Screen"/);
  expect(page).not.toMatch(/import InputPanel from/);
  expect(page).toMatch(/requestIdleCallback[\s\S]{0,200}preloadScreens\(\)/);
});
