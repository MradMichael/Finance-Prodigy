// FB-1b2 (SEC-09), Profile's half: what the owner sees when they regenerate
// a recovery code. The owner's rule (2026-10-05): when the server doesn't
// accept a new code, no code is displayed -- the refusal says why and that
// nothing changed. Showing a code the server doesn't know is worse than
// refusing, because the owner would save it believing it works.
//
// Profile also used to push after regenerating "so the new code works from
// another device". It never did -- a push keeps an already-registered
// recovery hash -- and the server's half now happens inside regenerate, so
// that push is gone.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const regenerate = vi.fn();
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(),
  regenerateRecoveryCode: (...a: unknown[]) => regenerate(...a),
}));
const pushSpy = vi.fn();
const pushRecoveryUpdateSpy = vi.fn();
vi.mock("../../lib/syncService", () => ({
  pushToServer: (...a: unknown[]) => pushSpy(...a), pullFromServer: vi.fn(), getLastSyncTime: () => null,
  confirmOverwriteIfNeeded: vi.fn(async () => true), mergeAndPush: vi.fn(), buildMergeNoticeText: () => ({ text: "" }),
  pushRecoveryUpdate: (...a: unknown[]) => pushRecoveryUpdateSpy(...a), applyBackupChoice: vi.fn(),
}));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { activateSessionKey } from "../../lib/crypto";

const CODE = "K7QM-4XPZ-9RTL-2WJC";
const DIALOG = "Generate a new recovery code? Once the new code is accepted, your old one stops working.";
const REFUSAL = "Your recovery code wasn't changed, because the server couldn't be reached. Nothing on your backup or this device has changed. Try again when you're online.";
const NOTE = "This code works on this device. If you turn backup on, it becomes your backup's code too.";

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
  regenerate.mockReset(); pushSpy.mockReset(); pushRecoveryUpdateSpy.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function pressRegenerate(confirmAnswer = true) {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(confirmAnswer);
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Generate new recovery code" }));
  return confirmSpy;
}

describe("regenerating from Profile", () => {
  it("asks first, in the approved words, and does nothing if declined", async () => {
    const confirmSpy = await pressRegenerate(false);
    expect(confirmSpy).toHaveBeenCalledWith(DIALOG);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("a refusal shows why, and no recovery code is displayed anywhere", async () => {
    regenerate.mockResolvedValue({ ok: false, error: REFUSAL });
    await pressRegenerate();
    expect(await screen.findByText(REFUSAL)).toBeTruthy();
    expect(screen.queryByText(/this is shown once/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
  });

  it("an acceptance shows the code, with its note when there is one", async () => {
    regenerate.mockResolvedValue({ ok: true, recoveryCode: CODE, note: NOTE });
    await pressRegenerate();
    expect(await screen.findByText(CODE)).toBeTruthy();
    expect(screen.getByText(/this is shown once/i)).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it("uploads nothing afterwards: the server's half happened inside regenerate", async () => {
    regenerate.mockResolvedValue({ ok: true, recoveryCode: CODE });
    await pressRegenerate();
    await screen.findByText(CODE);
    await waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1));
    expect(pushRecoveryUpdateSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("the section no longer says the old code stops working immediately", async () => {
    render(<ThemeProvider><ProfilePage /></ThemeProvider>);
    await screen.findByRole("button", { name: "Generate new recovery code" });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/stops working immediately/i);
    expect(text).toContain("Once the new code is accepted, your old one stops working.");
  });
});
