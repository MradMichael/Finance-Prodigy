// FB-1b: SEC-01 and TEST-01's sign-out half (2026-10-05).
//
// SEC-01: the recovery-derived token is the exact secret /relink checks
// (server/src/routes/sync.ts:309), and it sat in localStorage in plain text,
// readable by anyone with the browser while the owner was signed out -- enough
// to relink the account to tokens of their own and take the backup over. It's
// now kept only encrypted under the account's data key, which exists only in
// an unlocked tab. Existing plaintext copies migrate on the next unlock, and a
// failed migration never loses the token. No server code changes.
//
// TEST-01: sign-out cleared the data key only in a later microtask, and no
// test checked it at all. It now clears synchronously, and this fails if not.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signUp, signIn, signOut, recoverAccount, regenerateRecoveryCode, getRecoveryTokenForSync } from "./auth";
import { pullFromServer, relinkSync, confirmOverwriteIfNeeded, deleteFromServer } from "./syncService";
import { deriveRecoveryToken, hasActiveKey } from "./crypto";
import { DEFAULT_DATA } from "./localData";

vi.mock("./syncService", () => ({
  pullFromServer: vi.fn(), relinkSync: vi.fn(), confirmOverwriteIfNeeded: vi.fn(), deleteFromServer: vi.fn(),
  // FB-1b2: regenerating asks the server first. "No copy" keeps it on the
  // local path this file is about; the server paths have their own file.
  probeServerCopy: vi.fn(async () => ({ kind: "none" })),
}));

const USERS_KEY = "essa_users_v1";
const users = (): Record<string, unknown>[] => JSON.parse(localStorage.getItem(USERS_KEY) ?? "[]");
const record = (email: string) => users().find((u) => u.email === email)!;
// Everything this origin keeps in localStorage, as one string to search.
const storageText = () => Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? "").join("\n");

// Turns a record back into what a device updated before FB-1b holds.
function makeLegacy(email: string, token: string) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users().map((u) => {
    if (u.email !== email) return u;
    const { recoveryTokenEnc: _drop, ...rest } = u;
    return { ...rest, recoveryTokenForSync: token };
  })));
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.restoreAllMocks();
  vi.mocked(pullFromServer).mockReset().mockResolvedValue({ ok: false, error: "No data on server yet. Push first." });
  vi.mocked(relinkSync).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(confirmOverwriteIfNeeded).mockReset().mockResolvedValue(true);
  vi.mocked(deleteFromServer).mockReset();
});

describe("the recovery token is never stored in plain text (SEC-01)", () => {
  it("sign-up stores it encrypted only", async () => {
    const reg = await signUp("a@test.com", "Quartz Runner", "password12345");
    if (!reg.ok) throw new Error("setup");
    const token = await deriveRecoveryToken(reg.recoveryCode, "a@test.com");
    expect(storageText()).not.toContain(token);
    expect(record("a@test.com").recoveryTokenEnc).toBeTruthy();
    expect("recoveryTokenForSync" in record("a@test.com")).toBe(false);
  });

  it("regenerating the code stores the new token encrypted only", async () => {
    const reg = await signUp("a@test.com", "Quartz Runner", "password12345");
    if (!reg.ok) throw new Error("setup");
    const s = await signIn("a@test.com", "password12345");
    expect(s.ok).toBe(true);
    const next = await regenerateRecoveryCode(record("a@test.com").id as string);
    if (!next.ok) throw new Error("regenerate");
    expect(storageText()).not.toContain(await deriveRecoveryToken(next.recoveryCode, "a@test.com"));
    expect("recoveryTokenForSync" in record("a@test.com")).toBe(false);
  });

  it("a password reset on this device stores the new token encrypted only", async () => {
    const reg = await signUp("a@test.com", "Quartz Runner", "password12345");
    if (!reg.ok) throw new Error("setup");
    const res = await recoverAccount("a@test.com", reg.recoveryCode, "brandnewpassword1");
    if (!res.ok) throw new Error("recover");
    expect(storageText()).not.toContain(await deriveRecoveryToken(res.newRecoveryCode, "a@test.com"));
    expect("recoveryTokenForSync" in record("a@test.com")).toBe(false);
  });

  it("recovering onto a brand-new device stores the new token encrypted only", async () => {
    vi.mocked(pullFromServer).mockResolvedValue({ ok: true, data: { ...DEFAULT_DATA, userName: "Quartz Runner" }, syncedAt: "2026-10-05T00:00:00.000Z", hasRecoveryCode: true });
    const res = await recoverAccount("fresh@test.com", "K7QM-4XPZ-9RTL-2WJC", "brandnewpassword1");
    if (!res.ok) throw new Error("recover: " + res.error);
    expect(storageText()).not.toContain(await deriveRecoveryToken(res.newRecoveryCode, "fresh@test.com"));
    expect(record("fresh@test.com").recoveryTokenEnc).toBeTruthy();
    expect("recoveryTokenForSync" in record("fresh@test.com")).toBe(false);
  });
});

describe("reading the token respects the lock", () => {
  it("returns it in an unlocked session, and nothing once signed out", async () => {
    const reg = await signUp("a@test.com", "Quartz Runner", "password12345");
    if (!reg.ok) throw new Error("setup");
    await signIn("a@test.com", "password12345");
    expect(await getRecoveryTokenForSync("a@test.com")).toBe(await deriveRecoveryToken(reg.recoveryCode, "a@test.com"));
    signOut();
    expect(await getRecoveryTokenForSync("a@test.com")).toBeUndefined();
  });

  it("a damaged encrypted copy reads as nothing, without throwing, and sign-in still works", async () => {
    const reg = await signUp("a@test.com", "Quartz Runner", "password12345");
    if (!reg.ok) throw new Error("setup");
    localStorage.setItem(USERS_KEY, JSON.stringify(users().map((u) => ({ ...u, recoveryTokenEnc: '{"v":1,"iv":"AAAA","ct":"AAAA"}' }))));
    const s = await signIn("a@test.com", "password12345");
    expect(s.ok).toBe(true);
    expect(await getRecoveryTokenForSync("a@test.com")).toBeUndefined();
  });
});

describe("devices updated before this change migrate on their next unlock", () => {
  it("at sign-in: the plaintext goes, the encrypted copy holds the same token", async () => {
    const reg = await signUp("a@test.com", "Quartz Runner", "password12345");
    if (!reg.ok) throw new Error("setup");
    const token = await deriveRecoveryToken(reg.recoveryCode, "a@test.com");
    makeLegacy("a@test.com", token);
    expect(storageText()).toContain(token); // premise: this really is the old shape

    await signIn("a@test.com", "password12345");
    expect(storageText()).not.toContain(token);
    expect(record("a@test.com").recoveryTokenEnc).toBeTruthy();
    expect(await getRecoveryTokenForSync("a@test.com")).toBe(token);
  });

  it("in a session that's already open: the first read migrates it", async () => {
    const reg = await signUp("a@test.com", "Quartz Runner", "password12345");
    if (!reg.ok) throw new Error("setup");
    await signIn("a@test.com", "password12345");
    const token = await deriveRecoveryToken(reg.recoveryCode, "a@test.com");
    makeLegacy("a@test.com", token);

    expect(await getRecoveryTokenForSync("a@test.com")).toBe(token);
    expect(storageText()).not.toContain(token);
  });

  it("a failed migration never loses the token: the plaintext stays, the token is still read, and the next try succeeds", async () => {
    const reg = await signUp("a@test.com", "Quartz Runner", "password12345");
    if (!reg.ok) throw new Error("setup");
    await signIn("a@test.com", "password12345");
    const token = await deriveRecoveryToken(reg.recoveryCode, "a@test.com");
    makeLegacy("a@test.com", token);

    vi.spyOn(globalThis.crypto.subtle, "encrypt").mockRejectedValueOnce(new Error("simulated encryption failure"));
    expect(await getRecoveryTokenForSync("a@test.com")).toBe(token);
    expect(record("a@test.com").recoveryTokenForSync).toBe(token);
    expect("recoveryTokenEnc" in record("a@test.com")).toBe(false);

    expect(await getRecoveryTokenForSync("a@test.com")).toBe(token);
    expect(storageText()).not.toContain(token);
  });

  it("a locked device keeps its plaintext untouched -- there's no key to encrypt with yet -- and reads nothing", async () => {
    const reg = await signUp("a@test.com", "Quartz Runner", "password12345");
    if (!reg.ok) throw new Error("setup");
    const token = await deriveRecoveryToken(reg.recoveryCode, "a@test.com");
    makeLegacy("a@test.com", token);
    expect(await getRecoveryTokenForSync("a@test.com")).toBeUndefined();
    expect(record("a@test.com").recoveryTokenForSync).toBe(token);
  });
});

describe("sign-out removes the session secrets at once (TEST-01)", () => {
  it("clears the data key and the sync token before signOut returns", async () => {
    const reg = await signUp("a@test.com", "Quartz Runner", "password12345");
    if (!reg.ok) throw new Error("setup");
    await signIn("a@test.com", "password12345");
    // Premise: both secrets really are present, so their absence below means something.
    expect(sessionStorage.getItem("essa_ek_v1")).not.toBeNull();
    expect(sessionStorage.getItem("essa_st_v1")).not.toBeNull();
    expect(hasActiveKey()).toBe(true);

    signOut();
    // No await: a later microtask is too late, because the tab may already be handed on.
    expect(sessionStorage.getItem("essa_ek_v1")).toBeNull();
    expect(sessionStorage.getItem("essa_st_v1")).toBeNull();
    expect(hasActiveKey()).toBe(false);
  });
});
