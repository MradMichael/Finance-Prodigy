// Session 15: Profile's mount effect must not re-run because of the router's
// object identity, the dashboard's lesson (app/page.load-effect-deps.test.tsx).
//
// It was keyed on `[router]`. next/navigation's router is stable, but several
// Profile tests mock useRouter with a new object per call, so the effect ran
// on every render: each run started a loadData whose result set state, which
// re-rendered, which ran it again. There was always a loadData in flight, and
// when a test file's environment was torn down with one pending, its setState
// threw "window is not defined" as an unhandled rejection. CI's client (UTC)
// leg failed on exactly that (app/profile/page.reset-elsewhere.test.tsx) with
// every test passing. Mocked hostilely here, the load must run once.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
// Deliberately hostile: a brand-new router on every call.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));
const loads = vi.fn();
vi.mock("../../lib/localData", async (o) => {
  const actual = await o<typeof import("../../lib/localData")>();
  return { ...actual, loadData: vi.fn(async (id: string) => { loads(id); return { ...actual.DEFAULT_DATA } as LocalFinancials; }) };
});

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

it("loads the account once, whatever the router's identity", async () => {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  await screen.findByRole("button", { name: "Generate new recovery code" });
  await new Promise((r) => setTimeout(r, 300));
  expect(loads).toHaveBeenCalledTimes(1);
});
