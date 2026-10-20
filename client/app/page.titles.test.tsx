// Session 22, item 3 (wording drafts; approved and merged in session 23, b173718): A11Y-07. Every page and every
// app screen had one title, "ESSA: Earn Spend Save Achieve", and changing
// screens inside the app (React state, not a route) said nothing to a screen
// reader. Now each page has its own title, from its own heading; each app
// screen sets "<nav label> · ESSA"; and a change of screen is announced in a
// polite live region that's on the page before it speaks. Opening the app
// isn't announced, only a change.
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
let seed: LocalFinancials;
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => seed), saveData: vi.fn(async () => {}) };
});
vi.mock("../lib/syncService", () => ({
  fetchAndMerge: vi.fn(async (_e: string, local: () => LocalFinancials) => ({ ok: true, mergedData: local(), localChanged: false, serverBehind: false, addedFromServer: 0, conflictDetails: [], replacedCloses: [] })),
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  pushToServer: vi.fn(async () => ({ ok: true, syncedAt: "2026-10-07T19:00:00.000Z" })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "", showReviewLink: false }),
  hasAutoPulled: () => true, markAutoPulled: vi.fn(), getLastSyncTime: () => "2026-10-05T08:00:00.000Z",
  checkEmailExists: vi.fn(async () => true), applyBackupChoice: vi.fn(),
}));

import Home from "./page";
import { DEFAULT_DATA } from "../lib/localData";
import { metadata as signIn } from "./sign-in/layout";
import { metadata as signUp } from "./sign-up/layout";
import { metadata as recover } from "./recover/layout";
import { metadata as profile } from "./profile/layout";
import { metadata as about } from "./about/layout";
import { metadata as privacy } from "./privacy/layout";
import { metadata as terms } from "./terms/layout";
import { metadata as security } from "./security/layout";
import { metadata as admin } from "./admin/layout";

beforeEach(() => { seed = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials; document.title = "ESSA: Earn Spend Save Achieve"; });

it("each page has its own title, from its own heading", () => {
  expect([signIn, signUp, recover, profile, about, privacy, terms, security, admin].map((m) => m.title)).toEqual([
    "Sign in · ESSA",
    "Create your account · ESSA",
    "Recover your account · ESSA",
    "Profile · ESSA",
    "About · ESSA",
    "Privacy Policy · ESSA",
    "Terms of Service · ESSA",
    "Security · ESSA",
    "Admin panel · ESSA",
  ]);
});

it("the app's screens: titled by the screen, and a change of screen announced; opening isn't", async () => {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  await waitFor(() => expect(document.title).toBe("Overview · ESSA"));
  const region = document.getElementById("screen-announcer")!;
  expect(region.getAttribute("role")).toBe("status");
  expect(region.textContent).toBe("");
  fireEvent.click(screen.getAllByRole("button", { name: "Budget" })[0]);
  await waitFor(() => expect(document.title).toBe("Budget · ESSA"));
  expect(region.textContent).toBe("Showing Budget");
  fireEvent.click(screen.getAllByRole("button", { name: "Balance Check" })[0]);
  await waitFor(() => expect(document.title).toBe("Balance Check · ESSA"));
  expect(region.textContent).toBe("Showing Balance Check");
});
