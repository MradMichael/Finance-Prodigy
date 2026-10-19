// TEST-02 (blind-spot audit; session 24, item 5): Profile's own writes that no
// test checked. Import, restore, merge, export, the report range and an
// unreadable record are pinned elsewhere; these pin the rest:
// - Delete account deletes only once "delete" is typed, then goes to sign-in;
// - turning backup off (and deleting the server copy) applies that choice to
//   this device's data and stores what it returns;
// - the report opens in its own window with this device's data built into it.
// They pin today's behaviour; perturbations prove they bite.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { LocalFinancials, StoredTransaction } from "../../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.test", name: "Quartz Lantern" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const deleteAccount = vi.fn(async () => ({ serverCleanupOk: true }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: (...a: unknown[]) => deleteAccount(...(a as [])), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
const applyBackupChoice = vi.fn();
vi.mock("../../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncService")>();
  return { ...real, pushToServer: vi.fn(), pullFromServer: vi.fn(), getLastSyncTime: () => null, applyBackupChoice: (...a: unknown[]) => applyBackupChoice(...a) };
});
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData, loadData } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

const tx = { id: "t1", amount: 46.8, currency: "USD", bucket: "WANTS", category: "dining", description: "Bistro Margaux", date: "2026-10-18" } as StoredTransaction;
const backedUp = { ...DEFAULT_DATA, income: 3000, transactions: [tx], syncChoice: { enabled: true, decidedAt: "2026-10-01T08:00:00.000Z" } } as LocalFinancials;

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  ROUTER.push.mockReset(); deleteAccount.mockClear(); applyBackupChoice.mockReset();
  activateSessionKey(new Uint8Array(32).fill(7));
  await saveData(backedUp, "u1");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const open = async () => { render(<ThemeProvider><ProfilePage /></ThemeProvider>); await screen.findByRole("button", { name: /Download my data/ }); };

it("Delete account: nothing until \"delete\" is typed, then the account is deleted and sign-in opens", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Delete account & all data" }));
  const go = screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement;
  expect(go.disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText("delete"), { target: { value: "DELETE" } }); // the Field's label isn't tied to its input (noticed, session 24)
  fireEvent.click(go);
  await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith("u1"));
  await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/sign-in"));
});

it("turning backup off and deleting the server copy applies that choice to this device's data, and stores what comes back", async () => {
  applyBackupChoice.mockImplementation(async (_email: string, d: LocalFinancials) => ({ data: { ...d, syncChoice: { enabled: false, decidedAt: "2026-10-19T08:00:00.000Z" } }, result: { ok: true } }));
  await open();
  fireEvent.click(await screen.findByRole("switch", { name: "Automatic backup to ESSA's server" }));
  fireEvent.click(screen.getByRole("button", { name: "Turn off and delete the server copy" }));
  expect(await screen.findByText("✓ Backup is off and the server copy has been deleted.")).toBeTruthy();
  expect(applyBackupChoice).toHaveBeenCalledWith("u1@example.test", expect.objectContaining({ income: 3000, transactions: [expect.objectContaining({ id: "t1" })] }), "off-delete");
  expect((await loadData("u1")).syncChoice).toMatchObject({ enabled: false });
});

it("the report opens in its own window, built from this device's data", async () => {
  const written: string[] = [];
  const win = { document: { write: (h: string) => written.push(h), close: vi.fn() }, onload: null as null | (() => void), print: vi.fn(), close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
  await open();
  fireEvent.click(screen.getByRole("button", { name: /Download as PDF/ }));
  await waitFor(() => expect(written).toHaveLength(1));
  expect(written[0]).toContain("Quartz Lantern");
  expect(written[0]).toContain("Financial health");
  expect(win.document.close).toHaveBeenCalled();
});
