// Session 23, item 6 (owner; DRAFT WORDING, HELD): turning backup off and
// deleting the server copy, when the delete fails. Profile said "Backup is off,
// but deleting the server copy failed: <error> Try again, or delete your
// account to remove it." The delete's own failure text was "Could not reach
// server." (developer text, ERR-05); with ERR-05's sentence in its place,
// Profile would say "try again" twice. Two drafts, one sentence each, and the
// server's own errors keep today's frame.
import { it, expect, vi, beforeEach } from "vitest";
import { backupOffDeleteFailed } from "./backupOffMessages";
import { deleteFromServer, UNREACHABLE } from "./syncService";

vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(), getSession: () => null }));
const reply = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => { if (body === null) throw new Error("not JSON"); return body; } }));
beforeEach(() => { vi.unstubAllGlobals(); });

it("the delete never reaching the server: marked unreachable, in ERR-05's words", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  expect(await deleteFromServer("a@example.com", "tok")).toEqual({ ok: false, unreachable: true, error: UNREACHABLE });
});

it("a reply without the API's own error: its status kept, not HTTP text", async () => {
  reply(502, null);
  expect(await deleteFromServer("a@example.com", "tok")).toEqual({ ok: false, serverStatus: 502, error: "The server had a problem (error 502). Try again in a minute." });
});

it("Profile's sentence when the server couldn't be reached says \"try again\" once", () => {
  const text = backupOffDeleteFailed({ ok: false, unreachable: true, error: UNREACHABLE });
  expect(text).toBe("Backup is off, but the server couldn't be reached, so its copy wasn't deleted. If you're online, it may be starting up: try again in a minute, or delete your account to remove it.");
  expect(text.match(/try again/gi)).toHaveLength(1);
});

it("and when the server had a problem", () => {
  const text = backupOffDeleteFailed({ ok: false, serverStatus: 502, error: "The server had a problem (error 502). Try again in a minute." });
  expect(text).toBe("Backup is off, but the server had a problem (error 502), so its copy wasn't deleted. Try again in a minute, or delete your account to remove it.");
  expect(text.match(/try again/gi)).toHaveLength(1);
});

it("the API's own errors keep today's frame", () => {
  expect(backupOffDeleteFailed({ ok: false, error: "Invalid sync credentials for this account." })).toBe("Backup is off, but deleting the server copy failed: Invalid sync credentials for this account. Try again, or delete your account to remove it.");
  expect(backupOffDeleteFailed(undefined)).toBe("Backup is off, but deleting the server copy failed: unknown error Try again, or delete your account to remove it.");
});
