// PWA P5 (owner-approved, 2026-11-05): Profile's "App info" section carries the version line and "Check for
// updates" (components/VersionCheck.test.tsx has their states). Harness: page.load-effect-deps.test.tsx's.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { LocalFinancials } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));
vi.mock("../../lib/localData", async (o) => {
  const actual = await o<typeof import("../../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => { return { ...actual.DEFAULT_DATA } as LocalFinancials; }) };
});

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

import { CHECK_FOR_UPDATES } from "../../components/VersionCheck";

afterEach(cleanup);

it("App info shows the version and offers a check for updates", async () => {
  const reg = { active: { postMessage: (_m: unknown, ports: MessagePort[]) => ports[0].postMessage({ build: "KfybncMpfAH02yqFTO_v6", commit: "2448033" }) }, waiting: null, installing: null, update: async () => undefined };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve(reg) } });
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  const line = await screen.findByText("Version 2448033 (build KfybncMp)");
  const section = screen.getByRole("heading", { name: "App info" }).closest("div.rounded-2xl")!;
  expect(section.contains(line)).toBe(true);
  expect(section.contains(screen.getByRole("button", { name: CHECK_FOR_UPDATES }))).toBe(true);
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});
