// COPY-05 (blind-spot audit; raised by the owner 2026-09-30): the Overview's
// "never been backed up … go to Profile and push a backup" banner showed on
// an account that had chosen backup OFF. It kept urging an upload the user
// had declined, and following it uploads everything (a manual push isn't
// gated). Owner's rule: with backup off, nothing prompts an upload.
//
// The banner now consults the backup choice. With backup on, or still
// undecided, it shows as before; its wording is unchanged.
//
// Session 10, item 5 (owner): "never been backed up" only when it's known
// there's no server copy. No sync time on this device doesn't mean that: the
// time is per account since DI-16 (an account that synced under the old
// browser-wide time has none of its own), and storage can refuse to save it.
// With no time here, the server is asked; only its "no copy" shows the
// banner. A copy, or no answer, shows nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import FinancialDashboard from "./FinancialDashboard";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const ROUTER = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };
const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
let session: typeof SESSION | null = SESSION;
vi.mock("../lib/auth", () => ({ getSession: () => session, getRecoveryTokenForSync: vi.fn(async () => null) }));

let answer: () => Promise<Response>;
const fetchMock = vi.fn((_url: string, _init?: RequestInit) => answer());
const exists = (v: boolean) => () => Promise.resolve(new Response(JSON.stringify({ exists: v }), { status: 200 }));

beforeEach(() => {
  localStorage.clear(); // no last-sync time on this device
  session = SESSION;
  answer = exists(false);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ON = { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" };
function show(syncChoice?: LocalFinancials["syncChoice"]) {
  const data = { ...DEFAULT_DATA, income: 3000, ...(syncChoice ? { syncChoice } : {}) } as LocalFinancials;
  render(<FinancialDashboard data={computeDashboard(data)} financials={data} />);
}
const banner = () => screen.queryByText(/never been backed up/i);
/** Nothing claimed, once the server's answer (if any) has had time to land; and it was asked. */
async function nothingClaimed() {
  await new Promise((r) => setTimeout(r, 150));
  expect(banner()).toBeNull();
  expect(fetchMock).toHaveBeenCalledWith("/api/auth/check-email", expect.anything());
}

describe("the never-backed-up banner", () => {
  it("backup off: no prompt to upload, and nothing asked", async () => {
    show({ enabled: false, decidedAt: "2026-09-28T12:00:00.000Z" });
    await new Promise((r) => setTimeout(r, 50));
    expect(banner()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("backup on, no time here, and the server has no copy: shown as before", async () => {
    show(ON);
    expect(await screen.findByText(/never been backed up/i)).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/check-email");
  });

  it("undecided, no time here, and the server has no copy: shown as before", async () => {
    show(undefined);
    expect(await screen.findByText(/never been backed up/i)).toBeTruthy();
  });
});

describe("session 10: no false claim", () => {
  it("no time here, but the server has a copy: nothing shown", async () => {
    answer = exists(true);
    show(ON);
    await nothingClaimed();
  });

  it("no time here, and the server can't be reached: nothing shown", async () => {
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    show(ON);
    await nothingClaimed();
  });

  it("no time here, and the server answers with an error: nothing shown", async () => {
    answer = () => Promise.resolve(new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }));
    show(ON);
    await nothingClaimed();
  });

  it("no time here, and the server's answer isn't one: nothing shown", async () => {
    answer = () => Promise.resolve(new Response("<html>gateway</html>", { status: 200 }));
    show(ON);
    await nothingClaimed();
  });

  it("a sync time here: nothing shown, and nothing asked", async () => {
    localStorage.setItem("essa_last_sync_u1", "2026-10-05T08:00:00.000Z");
    show(ON);
    await new Promise((r) => setTimeout(r, 50));
    expect(banner()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
