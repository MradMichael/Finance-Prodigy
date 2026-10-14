// Session 22, item 3 (wording drafts, HELD): ERR-04. A stored record that
// won't decrypt made loadData throw DECRYPT_FAILED, on purpose, and nothing
// caught it: the page sat on its loading screen, and after 8 seconds said a
// slow connection or a stuck tab could cause this, with "Reload the page",
// which repeats it. Profile, the one way out, wasn't linked.
//
// Now a failed load says so at once, and links Profile, where an exported
// file can be restored (that restore reads nothing from the broken record)
// and Sign out is. The slow-load notice is unchanged, for a slow load.
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));
let failure: Error;
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => { throw failure; }), saveData: vi.fn(async () => {}) };
});
vi.mock("../lib/syncService", () => ({
  fetchAndMerge: vi.fn(), pullFromServer: vi.fn(), pushToServer: vi.fn(), mergeAndPush: vi.fn(),
  buildMergeNoticeText: () => ({ text: "", showReviewLink: false }),
  hasAutoPulled: () => true, markAutoPulled: vi.fn(), getLastSyncTime: () => null,
  checkEmailExists: vi.fn(async () => true), applyBackupChoice: vi.fn(),
}));

import Home from "./page";

beforeEach(() => { failure = new Error("DECRYPT_FAILED"); });

it("a record that won't decrypt: said at once, with Profile linked, not a loading screen", async () => {
  render(<Home />);
  expect(await screen.findByText("ESSA couldn't open the data saved in this browser.")).toBeTruthy();
  expect(screen.getByText("Nothing has been deleted. If reloading doesn't help, you can restore an exported file or sign out from Profile.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open Profile" }).getAttribute("href")).toBe("/profile");
  expect(screen.getByRole("button", { name: "Reload the page" })).toBeTruthy();
  expect(screen.queryByText("This is taking longer than expected.")).toBeNull();
});

it("it's announced: the message is in an alert", async () => {
  render(<Home />);
  const msg = await screen.findByText("ESSA couldn't open the data saved in this browser.");
  expect(msg.closest("[role='alert']")).not.toBeNull();
});

it("any other failed load says the same", async () => {
  failure = new Error("ENCRYPTION_KEY_MISSING");
  render(<Home />);
  expect(await screen.findByText("ESSA couldn't open the data saved in this browser.")).toBeTruthy();
});
