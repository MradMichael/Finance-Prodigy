// Session 22, item 3 (wording drafts, HELD): ERR-03 and ERR-05 in the sync service.
// - ERR-03: past the server's 2 MB cap, a push said only "Validation failed";
//   the reason was in `issues`, and nothing showed it. It's now named, with
//   what to do, and marked so the automatic backup stops retrying.
// - ERR-05: a request that never reached the server said "Could not reach
//   server. Is it running?", and a reply without the API's own error said
//   "Sync failed (HTTP 504)." Both are now in the user's words.
import { it, expect, vi, beforeEach } from "vitest";
import { pushToServer, pullFromServer, relinkSync, UNREACHABLE, BACKUP_TOO_LARGE } from "./syncService";
import { getSyncToken } from "./crypto";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

vi.mock("./crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./crypto")>();
  return { ...actual, getSyncToken: vi.fn() };
});
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(), getSession: () => null }));

const DATA = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
const answer = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => { if (body === null) throw new Error("not JSON"); return body; } }));
const unreachable = () => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

beforeEach(() => { vi.mocked(getSyncToken).mockReturnValue("tok"); });

it("ERR-03: the sentence, verbatim", () => {
  expect(BACKUP_TOO_LARGE).toBe("This backup wasn't saved: your data is larger than the 2 MB the server can hold. Export a copy to keep one safe.");
});

it("ERR-03: a push past the 2 MB cap names the cause, not \"Validation failed\", and is marked too large", async () => {
  answer(422, { error: "Validation failed", issues: [{ message: "data exceeds the 2000000-byte limit", path: ["data"] }] });
  expect(await pushToServer("a@example.com", DATA)).toEqual({ ok: false, tooLarge: true, error: BACKUP_TOO_LARGE });
});

it("ERR-03: any other 422 is unchanged", async () => {
  answer(422, { error: "Validation failed", issues: [{ message: "Invalid email", path: ["email"] }] });
  expect(await pushToServer("a@example.com", DATA)).toEqual({ ok: false, error: "Validation failed" });
});

it("ERR-05: the sentence, verbatim", () => {
  expect(UNREACHABLE).toBe("Couldn't reach the server. If you're online, it may be starting up: try again in a minute.");
});

it("ERR-05: a push, pull or relink that never reaches the server says so, without \"Is it running?\", and is marked unreachable", async () => {
  unreachable();
  expect(await pushToServer("a@example.com", DATA)).toEqual({ ok: false, unreachable: true, error: UNREACHABLE });
  expect(await pullFromServer("a@example.com")).toEqual({ ok: false, unreachable: true, error: UNREACHABLE });
  expect(await relinkSync("a@example.com", "t", "r")).toEqual({ ok: false, unreachable: true, error: UNREACHABLE });
});

it("ERR-05: a reply without the API's own error is the server's problem, in words, not HTTP text", async () => {
  answer(504, null);
  expect(await pushToServer("a@example.com", DATA)).toEqual({ ok: false, error: "The server had a problem (error 504). Try again in a minute." });
  answer(502, null);
  expect(await pullFromServer("a@example.com")).toEqual({ ok: false, error: "The server had a problem (error 502). Try again in a minute." });
  answer(503, null);
  expect(await relinkSync("a@example.com", "t", "r")).toEqual({ ok: false, error: "The server had a problem (error 503). Try again in a minute." });
});

it("ERR-05: the API's own errors still pass through as written", async () => {
  answer(500, { error: "Something went wrong on our side. Your data is safe." });
  expect(await pushToServer("a@example.com", DATA)).toEqual({ ok: false, error: "Something went wrong on our side. Your data is safe." });
});
