// Session 10, item 2 (owner's wording, session 11): Profile → Merge, when
// another device's "Reset all data" is on the server. The real mergeAndPush
// runs against a stubbed server holding that reset; the notice says so
// (lib/resetNotice.ts).
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { LocalFinancials, StoredTransaction } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(), getRecoveryTokenForSync: vi.fn(async () => null),
}));
let lastSynced: LocalFinancials;
vi.mock("../../lib/syncSeen", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncSeen")>();
  return { ...real, loadSeen: vi.fn(async () => real.seenOf(lastSynced)), saveSeen: vi.fn(async () => {}) };
});
vi.mock("../../lib/clashNotice", () => ({ takeUnseenClashes: vi.fn(async () => []) }));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, resetFinancials, saveData } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";
import { dayLabel } from "../../lib/period";

const RESET_AT = new Date("2026-10-09T12:00:00.000Z");
const tx = (id: string): StoredTransaction => ({ id, amount: 46.8, currency: "USD", bucket: "WANTS", category: "dining", description: id, date: "2026-10-01", updatedAt: "2026-10-01T12:00:00.000Z" } as StoredTransaction);
const HELD_HERE = { ...DEFAULT_DATA, income: 3150.75, syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" }, transactions: [tx("Quartz bistro")] } as LocalFinancials;

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem("essa_st_v1", "tok");
  activateSessionKey(new Uint8Array(32).fill(7));
  await saveData(HELD_HERE, "u1"); lastSynced = HELD_HERE;
  const serverCopy = resetFinancials(HELD_HERE, RESET_AT);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/pull")
    ? new Response(JSON.stringify({ data: serverCopy, syncedAt: RESET_AT.toISOString(), hasRecoveryCode: true }), { status: 200 })
    : new Response(JSON.stringify({ syncedAt: "2026-10-09T13:00:00.000Z" }), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("Merge says another device reset all data (R1)", async () => {
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Merge$/ }));
  expect(await screen.findByText(`✓ Merged. Your other device reset all data on ${dayLabel(RESET_AT)}. This device now matches it.`)).toBeTruthy();
});
