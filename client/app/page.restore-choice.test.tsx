// Item 3b (owner, session 25): what a person saw after a restore carried the
// backup choice over, reproduced on the dashboard that opens after the
// restore's reload. The stored record is what Profile's file restore writes
// (restoreFromExport over this device's record).
// - A file with no choice, over a device that turned backup on: the dashboard
//   asked again, in the "backed up automatically … without asking" form,
//   which is untrue for someone who chose it.
// - A file saved with backup on, over a device that turned it off: the
//   dashboard synced with the server again, without asking.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";
import { restoreFromExport } from "../lib/syncMerge";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
type Choice = NonNullable<LocalFinancials["syncChoice"]>;
const ON: Choice = { enabled: true, decidedAt: "2026-10-01T08:00:00.000Z" };
const OFF: Choice = { enabled: false, decidedAt: "2026-10-12T08:00:00.000Z" };
const record = (syncChoice?: Choice, income = 3000) => ({ ...DEFAULT_DATA, income, transactions: [], ...(syncChoice ? { syncChoice } : {}) }) as LocalFinancials;

let store: LocalFinancials;
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), getRecoveryTokenForSync: () => null }));
vi.mock("../lib/crypto", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/crypto")>()), getSyncToken: () => "token" }));
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => store), saveData: vi.fn(async (d: LocalFinancials) => { store = d; }) };
});
vi.mock("../lib/syncSeen", () => ({ saveSeen: vi.fn(async () => {}), loadSeen: vi.fn(async () => null) }));
vi.mock("../lib/clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));
const serverCalls: string[] = [];
vi.mock("../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/syncService")>();
  return {
    ...real,
    pullFromServer: vi.fn(async () => { serverCalls.push("pull"); return { ok: false, error: "offline" }; }),
    fetchAndMerge: vi.fn(async () => { serverCalls.push("fetch"); return { ok: false, error: "offline" }; }),
    pushToServer: vi.fn(async () => { serverCalls.push("push"); return { ok: false, error: "offline" }; }),
    mergeAndPush: vi.fn(async () => { serverCalls.push("merge"); return { ok: false, error: "offline" }; }),
    checkEmailExists: vi.fn(async () => true), // the server holds a copy
  };
});

import Home from "./page";

beforeEach(() => {
  localStorage.clear(); serverCalls.length = 0;
  localStorage.setItem("essa_auto_pull_done_u1", "1");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openAfterRestore(device: LocalFinancials, file: LocalFinancials) {
  store = restoreFromExport(device, file);
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
}

it("a file with no choice over a device that turned backup on: no \"backed up automatically … without asking\" prompt", { timeout: 30000 }, async () => {
  await openAfterRestore(record(ON), record(undefined, 3150.75));
  expect(screen.queryByText("Your data has been backed up automatically")).toBeNull();
  expect(screen.queryByRole("dialog", { name: /backed up|Back up/ })).toBeNull();
});

it("a file saved with backup on over a device that turned it off: nothing is fetched from or sent to the server", { timeout: 30000 }, async () => {
  await openAfterRestore(record(OFF), record(ON, 3150.75));
  expect(serverCalls).toEqual([]);
});
