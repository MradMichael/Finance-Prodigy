// Session 28, item 3 (owner; wording approved, merged in session 29): Profile
// lists this account's kept copies (how many, and when) and opens one with the
// password it was locked with: merged into the current data as a fetched copy
// is, saved, and only then removed. A wrong password, or a save that fails,
// changes nothing and keeps the copy.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { LocalFinancials, StoredTransaction } from "../../lib/localData";

const SESSION = { userId: "u1", email: "quartz@test.com", name: "Quartz Lantern" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../lib/auth")>()),
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
vi.mock("../../lib/syncService", async (orig) => ({
  ...(await orig<typeof import("../../lib/syncService")>()), pushToServer: vi.fn(), pullFromServer: vi.fn(), getLastSyncTime: () => null,
}));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData, loadData } from "../../lib/localData";
import { activateSessionKey, createEnvelopes, sealWithDek } from "../../lib/crypto";

const OLD = "old-password-123", CURRENT = "current-password-456";
const KEY = "essa_unreadable_u1_2026-10-20T09:00:00.000Z";
const tx = (id: string, description: string) => ({ id, amount: 12, currency: "USD", bucket: "WANTS", description, date: "2026-10-18", createdAt: "2026-10-18T08:00:00.000Z" }) as StoredTransaction;
const CURRENT_DATA = { ...DEFAULT_DATA, income: 3000, transactions: [tx("t1", "Lunch")] } as LocalFinancials;
const COPY_DATA = { ...DEFAULT_DATA, income: 3000, transactions: [tx("t1", "Lunch"), tx("t2", "Copper kettle")] } as LocalFinancials;

async function setUp(withCopy = true) {
  const env = await createEnvelopes(CURRENT, "u1");
  localStorage.setItem("essa_users_v1", JSON.stringify([{ id: "u1", email: SESSION.email, name: SESSION.name, pwHash: "pbkdf2:x", createdAt: "2026-10-01T00:00:00.000Z", isAdmin: true, wrappedDekPassword: env.wrappedPassword, wrappedDekRecovery: env.wrappedRecovery }]));
  activateSessionKey(env.dek);
  await saveData(CURRENT_DATA, "u1");
  if (!withCopy) return;
  const old = await createEnvelopes(OLD, "u1");
  localStorage.setItem(KEY, await sealWithDek(old.dek, JSON.stringify(COPY_DATA)));
  localStorage.setItem(`${KEY}_envelopes`, JSON.stringify({ wrappedDekPassword: old.wrappedPassword, wrappedDekRecovery: old.wrappedRecovery }));
}
const open = async () => { render(<ThemeProvider><ProfilePage /></ThemeProvider>); await screen.findByRole("button", { name: /Download my data/ }); };
const field = () => screen.getByLabelText("Password it was locked with", { exact: true, selector: "input" });

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("lists the kept copies by count and date, and nothing of their contents", async () => {
  await setUp();
  await open();
  expect(screen.getByRole("heading", { name: "Copies kept on this device" })).toBeTruthy();
  expect(screen.getByText("These are copies of data this browser couldn't open, kept so nothing is lost. Enter the password one was locked with to merge it into your data.")).toBeTruthy();
  expect(screen.getByText("1 copy kept")).toBeTruthy();
  expect(screen.getByText("Kept on 20/10/2026")).toBeTruthy();
  expect(screen.queryByText(/Copper kettle/)).toBeNull();
});

it("with no kept copies there's no section", async () => {
  await setUp(false);
  await open();
  expect(screen.queryByRole("heading", { name: "Copies kept on this device" })).toBeNull();
});

it("a wrong password says so and changes nothing", async () => {
  await setUp();
  await open();
  fireEvent.change(field(), { target: { value: "wrong-password-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Open and merge" }));
  expect(await screen.findByText("That password doesn't open this copy.")).toBeTruthy();
  expect(localStorage.getItem(KEY)).not.toBeNull();
  expect((await loadData("u1")).transactions.map((t) => t.id)).toEqual(["t1"]);
});

it("the right password merges the copy, saves, then removes it", async () => {
  await setUp();
  await open();
  fireEvent.change(field(), { target: { value: OLD } });
  fireEvent.click(screen.getByRole("button", { name: "Open and merge" }));
  expect(await screen.findByText(/^✓ The copy was merged into your data\./)).toBeTruthy();
  await waitFor(async () => expect((await loadData("u1")).transactions.map((t) => t.id).sort()).toEqual(["t1", "t2"]));
  expect(localStorage.getItem(KEY)).toBeNull();
  expect(localStorage.getItem(`${KEY}_envelopes`)).toBeNull();
});

it("a save that fails keeps the copy and says so", async () => {
  await setUp();
  await open();
  const real = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    if (k === "essa_data_u1") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    return real.call(this, k, v);
  });
  fireEvent.change(field(), { target: { value: OLD } });
  fireEvent.click(screen.getByRole("button", { name: "Open and merge" }));
  expect(await screen.findByText("Couldn't save the merged data on this device. This browser has run out of storage space for ESSA. The copy is still kept.")).toBeTruthy();
  expect(localStorage.getItem(KEY)).not.toBeNull();
});
