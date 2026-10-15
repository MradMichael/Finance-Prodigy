// Session 23, item 5 (owner): a conflict merge whose push is refused for size
// (past the server's 2 MB) returned only an error, so the automatic backup
// showed "conflict" and never ERR-03's notice. mergeAndPush now passes the
// push's tooLarge through.
import { it, expect, vi, beforeEach } from "vitest";
import { mergeAndPush, BACKUP_TOO_LARGE } from "./syncService";
import { getSyncToken } from "./crypto";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

vi.mock("./crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./crypto")>();
  return { ...actual, getSyncToken: vi.fn() };
});
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(), getSession: () => null }));

const LOCAL = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
const SERVER = { ...DEFAULT_DATA, income: 3100 } as LocalFinancials;
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => { vi.mocked(getSyncToken).mockReturnValue("tok"); });

it("the merged push refused for size comes back marked too large, with ERR-03's sentence", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/pull")
    ? reply(200, { data: SERVER, syncedAt: "2026-10-15T08:00:00.000Z", hasRecoveryCode: false })
    : reply(422, { error: "Validation failed", issues: [{ message: "data exceeds the 2000000-byte limit", path: ["data"] }] })));
  const r = await mergeAndPush("a@example.com", LOCAL);
  expect(r).toMatchObject({ ok: false, tooLarge: true, error: BACKUP_TOO_LARGE });
});

it("any other refused merged push isn't marked too large", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/pull")
    ? reply(200, { data: SERVER, syncedAt: "2026-10-15T08:00:00.000Z", hasRecoveryCode: false })
    : reply(500, { error: "Something went wrong on our side. Your data is safe." })));
  const r = await mergeAndPush("a@example.com", LOCAL);
  expect(r.ok).toBe(false);
  expect((r as { tooLarge?: boolean }).tooLarge).toBeFalsy();
});
