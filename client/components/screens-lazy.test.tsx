// R3 (owner, session 33, DECISIONS_PENDING 23 (a)): the screens other than the Overview load on first use,
// and all of them are fetched once the browser is idle. This tests the lazy module itself; the page tests
// use its plain twin (screens.sync.tsx, through vitest.config.ts's alias).
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { WishlistScreen, CategoriesScreen, preloadScreens, lazyScreen } from "../app/screens.lazy";
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

it("a screen whose code failed to load (offline) tries again the next time it opens", async () => {
  // Session 33's offline live check: the failed attempt was kept, so the screen stayed blank all session.
  let calls = 0;
  const Back = () => <h2>Back online</h2>;
  const Flaky = lazyScreen<object>(() => (++calls === 1 ? Promise.reject(new Error("Loading chunk failed")) : Promise.resolve({ default: Back })));
  const first = render(<Flaky />);
  await waitFor(() => expect(calls).toBe(1));
  await new Promise((r) => setTimeout(r, 0));
  expect(first.container.textContent).toBe("");
  first.unmount();
  render(<Flaky />);
  expect(await screen.findByRole("heading", { name: "Back online" })).toBeTruthy();
  expect(calls).toBe(2);
});

it("preloading settles even when a screen's code can't load, and that screen tries again", async () => {
  let calls = 0;
  const Later = () => <h2>Loaded later</h2>;
  const Flaky = lazyScreen<object>(() => (++calls === 1 ? Promise.reject(new Error("Loading chunk failed")) : Promise.resolve({ default: Later })));
  await expect(preloadScreens([Flaky])).resolves.toBeUndefined();
  expect(calls).toBe(1);
  render(<Flaky />);
  expect(await screen.findByRole("heading", { name: "Loaded later" })).toBeTruthy();
});

it("the page takes its screens from the lazy module and preloads them when idle", () => {
  const page = fs.readFileSync(path.join(__dirname, "../app/page.tsx"), "utf8");
  expect(page).toMatch(/from "\.\/screens\.lazy"/);
  expect(page).not.toMatch(/from "\.\.\/components\/screens\/(Budget|Statistics|Trips)Screen"/);
  expect(page).not.toMatch(/import InputPanel from/);
  // Both paths preload: the idle callback, and the timer where requestIdleCallback is missing.
  expect(page).toMatch(/requestIdleCallback\(\s*\(\)\s*=>\s*\{\s*void preloadScreens\(\);/);
  expect(page).toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{\s*void preloadScreens\(\);/);
});
