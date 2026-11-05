// PWA P3 (owner-approved, 2026-11-05): Profile's "Your data" section carries the storage lines
// (components/StorageKeep.test.tsx has their states). Harness: page.load-effect-deps.test.tsx's.
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

import { STORAGE_HEADING, STORAGE_NOT_YET } from "../../components/StorageKeep";

afterEach(cleanup);

it("Your data says what this browser reports about keeping ESSA's data", async () => {
  Object.defineProperty(navigator, "storage", { configurable: true, value: { persisted: async () => false, persist: async () => false } });
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  const heading = await screen.findByRole("heading", { name: STORAGE_HEADING });
  const section = heading.closest("section, div.rounded-2xl")!;
  expect(section.textContent).toContain("Your data");
  expect(await screen.findByText(STORAGE_NOT_YET)).toBeTruthy();
});
