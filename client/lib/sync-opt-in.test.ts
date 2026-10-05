// Opt-in sync, part 1 (audit 2.4.153) -- the decision function.
//
// FB-1b2 (2026-10-05): the one upload site that used to sit outside autoSync,
// Profile's push after regenerating a recovery code, is gone, and so are its
// tests here. That push never did what it was for (a push keeps an
// already-registered recovery hash); regenerate now replaces the server's
// code through /relink, and regenerate-reaches-server.test.ts covers it,
// including that it sends nothing when nothing can exist.
import { describe, it, expect } from "vitest";
import { syncAllowed, DEFAULT_DATA } from "./localData";

const at = "2026-09-28T10:00:00.000Z";

describe("syncAllowed -- the single decision", () => {
  it("undecided is NOT allowed: paused, not on", () => {
    expect(syncAllowed({})).toBe(false);
  });
  it("off is not allowed", () => {
    expect(syncAllowed({ syncChoice: { enabled: false, decidedAt: at } })).toBe(false);
  });
  it("on is allowed", () => {
    expect(syncAllowed({ syncChoice: { enabled: true, decidedAt: at } })).toBe(true);
  });
  it("a new account starts undecided -- DEFAULT_DATA carries no choice", () => {
    expect(DEFAULT_DATA.syncChoice).toBeUndefined();
    expect(syncAllowed(DEFAULT_DATA)).toBe(false);
  });
});

