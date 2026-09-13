// The load effect must not re-run because of an external library's object
// identity.
//
// Its `[router]` dependency made correctness rest on `useRouter()` returning
// a referentially stable object — true of next/navigation today, guaranteed
// by nothing in this repo. When that assumption breaks, the effect re-runs on
// every render, each run calling setFinancials with a freshly loaded
// (history-less) snapshot, which the monthly-snapshot effect then legitimately
// writes back — a render/persist loop with no ceiling.
//
// That is not hypothetical: an unstable useRouter mock in a sibling test
// produced 1039 saveData calls in seven seconds, and swapping in a stable
// object took it to 1. This test pins that down by mocking useRouter
// HOSTILELY — a new object on every call — and asserting the write count
// stays bounded anyway. The effect must not care.
//
// The non-obvious consequence, and the reason a loop here would be quiet
// rather than loud: handleChange clears and re-arms the 2500ms sync timer on
// every call, so at loop speed the debounce re-arms far faster than it ever
// fires. Sync would be STARVED, not hammered — no push, no error, no
// indication, while localStorage is rewritten hundreds of times a second.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import type { LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };

// Deliberately hostile: a brand-new object on every single call, which is
// exactly what a dependency array keyed on it cannot tolerate.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("../lib/auth", () => ({
  getSession: () => SESSION,
  hasValidSession: () => true,
  signOut: vi.fn(),
}));

const saved: LocalFinancials[] = [];
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return {
    ...actual,
    loadData: vi.fn(async () => ({ ...actual.DEFAULT_DATA, transactions: [] })),
    saveData: vi.fn(async (d: LocalFinancials) => { saved.push(d); }),
  };
});

vi.mock("../lib/syncService", () => ({
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  pushToServer: vi.fn(async () => ({ ok: true })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "" }),
  hasAutoPulled: vi.fn(() => true),   // no pull: isolates the dependency question
  markAutoPulled: vi.fn(),
  getLastSyncTime: () => null,
}));

import Home from "./page";

beforeEach(() => { localStorage.clear(); saved.length = 0; });

describe("the load effect is not re-triggered by useRouter's object identity", () => {
  it("persists a bounded number of times under a router that changes identity every render", { timeout: 30000 }, async () => {
    render(<StrictMode><Home /></StrictMode>);
    await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });

    // One settled write is expected and correct: the monthly-snapshot effect
    // recording this month's entries once. Anything unbounded is the loop.
    await new Promise((r) => setTimeout(r, 3000));
    const atSettle = saved.length;
    await new Promise((r) => setTimeout(r, 3000));
    const later = saved.length;

    // The discriminator: it must not still be climbing. Pre-fix this reads in
    // the hundreds and rises every second; post-fix both numbers are 1.
    expect(later).toBe(atSettle);
    expect(later).toBeLessThanOrEqual(3);
  });
});
