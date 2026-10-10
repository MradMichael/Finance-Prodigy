// ERR-01 (2026-09-30): a failed save was silent. handleChange
// put the edit on screen first, then awaited saveData with no catch -- so a
// refused write left an entry that looked kept, and it was gone on reload.
//
// Real saveData and real encryption here. Only localStorage is touched: writes
// to the data record throw the browser's own QuotaExceededError, the way a
// full store does, and every other key writes normally.
//
// WHICH AXES THESE FIXTURES CANNOT REACH (2.4.116):
//   * other refusal kinds (blocked storage, a missing key). They take the same
//     catch; saveFailureKind's own tests cover the naming.
//   * a refusal mid-way through two overlapping saves. The superseded save's
//     failure is deliberately left to the newer save to report.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LocalFinancials } from "../lib/localData";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../lib/auth", () => ({ getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn() }));

let seed: LocalFinancials;
vi.mock("../lib/localData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/localData")>();
  return { ...actual, loadData: vi.fn(async () => seed) }; // saveData stays real
});
vi.mock("../lib/syncService", () => ({
  pullFromServer: vi.fn(async () => ({ ok: false, error: "none" })),
  pushToServer: vi.fn(async () => ({ ok: true })),
  mergeAndPush: vi.fn(async () => ({ ok: false })),
  buildMergeNoticeText: () => ({ text: "" }),
  hasAutoPulled: vi.fn(() => true),
  markAutoPulled: vi.fn(),
  serverCopyExists: vi.fn(async () => null), getLastSyncTime: () => null,
  checkEmailExists: vi.fn(async () => false),
  applyBackupChoice: vi.fn(),
}));

import Home from "./page";
import { DEFAULT_DATA } from "../lib/localData";
import { activateSessionKey } from "../lib/crypto";

const DATA_KEY = "essa_data_u1";
let refuse = false;
let dataWrites = 0;
let setItemSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
  refuse = false; dataWrites = 0;
  const realSetItem = Storage.prototype.setItem;
  setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    if (key === DATA_KEY) {
      dataWrites++;
      if (refuse) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    }
    return realSetItem.call(this, key, value);
  });
  // Backup decided (off), so no prompt blocks the screen and nothing uploads.
  seed = { ...DEFAULT_DATA, income: 3000, syncChoice: { enabled: false, decidedAt: "2026-09-01T09:00:00.000Z" } } as LocalFinancials;
});
afterEach(() => setItemSpy.mockRestore());

async function openWishlist() {
  render(<Home />);
  await screen.findByRole("button", { name: "Setup" }, { timeout: 10000 });
  fireEvent.click(screen.getAllByRole("button", { name: "Wishlist" })[0]);
  await screen.findByPlaceholderText("Noise-cancelling headphones…");
}

// The item renders as "{emoji} {name}" in one node, so its own delete button
// (exact accessible name) is the reliable sign it is on screen.
const wishOnScreen = (name: string) => screen.queryByRole("button", { name: `Delete ${name} from wishlist` });

function addWish(name: string, price: string) {
  fireEvent.change(screen.getByPlaceholderText("Noise-cancelling headphones…"), { target: { value: name } });
  fireEvent.change(document.getElementById("wish-price")!, { target: { value: price } });
  fireEvent.click(screen.getByRole("button", { name: "+ Add to wishlist" }));
}

describe("a save that fails tells the user (ERR-01)", () => {
  it("says so plainly, and the entry doesn't stay on screen looking saved", async () => {
    await openWishlist();
    // Premise: the load-time snapshot write reached storage, so there is a
    // stored record for "nothing changed underneath" to compare against.
    await waitFor(() => expect(localStorage.getItem(DATA_KEY)).not.toBeNull());
    const before = localStorage.getItem(DATA_KEY);

    refuse = true;
    addWish("Standing desk", "300");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Couldn.t save on this device/);
    expect(alert.textContent).toMatch(/run out of storage space/);
    expect(wishOnScreen("Standing desk")).toBeNull();
    expect(screen.getByText("Nothing on your wishlist yet.")).toBeTruthy();
    expect(localStorage.getItem(DATA_KEY)).toBe(before);
  });

  it("once storage takes writes again, the next change saves and the message goes", async () => {
    await openWishlist();
    await waitFor(() => expect(localStorage.getItem(DATA_KEY)).not.toBeNull());
    const before = localStorage.getItem(DATA_KEY);
    refuse = true;
    addWish("Standing desk", "300");
    await screen.findByRole("alert");

    refuse = false;
    addWish("Standing desk", "300");

    await waitFor(() => expect(wishOnScreen("Standing desk")).not.toBeNull());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(localStorage.getItem(DATA_KEY)).not.toBe(before);
  });

  it("a write refused on load is reported once, not retried in a loop, and dismissing it sticks", async () => {
    refuse = true;
    render(<Home />);
    await screen.findByRole("alert", undefined, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1500));
    // The snapshot write on load is the only automatic write here; after it
    // fails, automatic writes wait for the user's next change.
    expect(dataWrites).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss save error" }));
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(dataWrites).toBe(1);
  });
});
