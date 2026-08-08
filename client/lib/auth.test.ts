import { describe, it, expect, beforeEach, vi } from "vitest";
import { signUp, signIn, recoverAccount, getSession, hasValidSession, signOut, isAdmin, listUsers, getRecoveryTokenForSync, type StoredUser } from "./auth";
import { pullFromServer, relinkSync } from "./syncService";

vi.mock("./syncService", () => ({
  pullFromServer: vi.fn(),
  relinkSync: vi.fn(),
  getRecoveryTokenForSync: vi.fn(),
}));

const USERS_KEY = "essa_users_v1";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(pullFromServer).mockReset();
  vi.mocked(relinkSync).mockReset();
  // Default: no synced data anywhere — matches signIn's "no local account,
  // and nothing to pull either" case unless a test overrides this.
  vi.mocked(pullFromServer).mockResolvedValue({ ok: false, error: "No data on server yet. Push first." });
  // Default: recoverAccount's sync fallback (recoverFromSync) finds no
  // matching account/recovery-code server-side either, unless overridden.
  vi.mocked(relinkSync).mockResolvedValue({ ok: false, error: "Could not verify ownership of this account's sync data." });
});

// Replicates auth.ts's private legacy djb2 hash, purely to construct a
// pre-PBKDF2, pre-recovery-code fixture user for migration-path tests.
function legacyHashPw(pw: string): string {
  let h = 5381;
  for (let i = 0; i < pw.length; i++) h = (Math.imul(h, 33) ^ pw.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function injectLegacyUser(email: string, password: string): void {
  const user: StoredUser = {
    id: "legacy-id-1", email, name: "Legacy User",
    pwHash: legacyHashPw(password), createdAt: "2025-01-01T00:00:00.000Z", isAdmin: true,
    // no wrappedDekPassword / wrappedDekRecovery -- pre-dates recovery codes
  };
  localStorage.setItem(USERS_KEY, JSON.stringify([user]));
}

describe("signUp", () => {
  it("creates an account and returns a recovery code", async () => {
    const result = await signUp("a@test.com", "Alice", "password12345");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("rejects a password under 10 characters", async () => {
    const result = await signUp("a@test.com", "Alice", "abc");
    expect(result).toEqual({ ok: false, error: "Password must be at least 10 characters." });
  });

  it("rejects missing fields", async () => {
    const result = await signUp("", "Alice", "password12345");
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed email that the server's stricter validation would later 422 on", async () => {
    for (const bad of ["test", "admin@localhost", "no-at-sign.com", "@missing-local.com"]) {
      const result = await signUp(bad, "Alice", "password12345");
      expect(result).toEqual({ ok: false, error: "Enter a valid email address." });
    }
  });

  it("accepts well-formed emails", async () => {
    const result = await signUp("real.person+tag@example.co.uk", "Alice", "password12345");
    expect(result.ok).toBe(true);
  });

  it("rejects a duplicate email (case-insensitive)", async () => {
    await signUp("a@test.com", "Alice", "password12345");
    const result = await signUp("A@TEST.COM", "Alice2", "password23456");
    expect(result).toEqual({ ok: false, error: "An account with this email already exists." });
  });

  it("makes the first registered account an admin, and later ones not", async () => {
    await signUp("first@test.com", "First", "password12345");
    await signUp("second@test.com", "Second", "password23456");
    const users = listUsers();
    const first = users.find((u) => u.email === "first@test.com")!;
    const second = users.find((u) => u.email === "second@test.com")!;
    expect(first.isAdmin).toBe(true);
    expect(second.isAdmin).toBeFalsy();
  });
});

describe("signIn", () => {
  it("rejects an email with no local account and nothing synced for it either", async () => {
    const result = await signIn("nobody@test.com", "password12345");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No account found/);
  });

  it("signs in via a synced pull when this email has no local account yet (e.g. a new device)", async () => {
    vi.mocked(pullFromServer).mockResolvedValue({
      ok: true,
      syncedAt: "2026-01-01T00:00:00.000Z",
      data: { ...(await import("./localData")).DEFAULT_DATA, userName: "Remote Name", income: 5000 },
    });
    const result = await signIn("newdevice@test.com", "password12345");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.email).toBe("newdevice@test.com");
      expect(result.session.name).toBe("Remote Name");
      // A local account now exists for next time, provisioned from the pull.
      const users = listUsers();
      expect(users.some((u) => u.email === "newdevice@test.com")).toBe(true);
    }
  });

  it("does not provision a local account when the sync pull fails (wrong password or truly no account)", async () => {
    vi.mocked(pullFromServer).mockResolvedValue({ ok: false, error: "Pull failed (HTTP 401)." });
    await signIn("nobody@test.com", "wrongpassword123");
    expect(listUsers().some((u) => u.email === "nobody@test.com")).toBe(false);
  });

  it("rejects the wrong password", async () => {
    await signUp("a@test.com", "Alice", "password12345");
    const result = await signIn("a@test.com", "wrong-password");
    expect(result).toEqual({ ok: false, error: "Incorrect password." });
  });

  it("succeeds with the correct password and establishes a session", async () => {
    await signUp("a@test.com", "Alice", "password12345");
    const result = await signIn("a@test.com", "password12345");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.email).toBe("a@test.com");
      expect(getSession()?.email).toBe("a@test.com");
    }
  });

  it("does not surface a recoveryCode on an ordinary sign-in (only on first-time migration)", async () => {
    await signUp("a@test.com", "Alice", "password12345");
    const result = await signIn("a@test.com", "password12345");
    expect(result.ok && result.recoveryCode).toBeUndefined();
  });

  it("upgrades a legacy djb2-hashed account on successful sign-in, and issues a recovery code", async () => {
    injectLegacyUser("legacy@test.com", "old-password");
    const result = await signIn("legacy@test.com", "old-password");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recoveryCode).toBeTruthy(); // migration just happened

    const usersRaw = JSON.parse(localStorage.getItem(USERS_KEY)!) as StoredUser[];
    const upgraded = usersRaw.find((u) => u.email === "legacy@test.com")!;
    expect(upgraded.pwHash.startsWith("pbkdf2:")).toBe(true);
    expect(upgraded.wrappedDekPassword).toBeTruthy();
    expect(upgraded.wrappedDekRecovery).toBeTruthy();

    // Signing in again afterward should no longer emit a recovery code (already migrated).
    const second = await signIn("legacy@test.com", "old-password");
    expect(second.ok && second.recoveryCode).toBeUndefined();
  });

  it("rejects an incorrect password for a legacy account that already has real stored data, rather than trusting the weak checksum alone", async () => {
    // migrateLegacyEnvelope + encryptJSON with the REAL password produce the
    // stored data blob a genuine legacy account would have — this is the
    // scenario the fix targets: verifyLegacyPassword must reject a wrong
    // password even if some other code path thought it looked right.
    const { migrateLegacyEnvelope, activateSessionKey, encryptJSON } = await import("./crypto");
    injectLegacyUser("legacy2@test.com", "real-password");
    const migrated = await migrateLegacyEnvelope("real-password", "legacy-id-1");
    activateSessionKey(migrated.dek);
    const encrypted = await encryptJSON(JSON.stringify({ real: "data" }));
    localStorage.setItem("essa_data_legacy-id-1", encrypted);

    const result = await signIn("legacy2@test.com", "wrong-password");
    expect(result).toEqual({ ok: false, error: "Incorrect password." });

    // Confirm the wrong sign-in attempt didn't touch the stored account at all.
    const usersRaw = JSON.parse(localStorage.getItem(USERS_KEY)!) as StoredUser[];
    const untouched = usersRaw.find((u) => u.email === "legacy2@test.com")!;
    expect(untouched.pwHash.startsWith("pbkdf2:")).toBe(false);
    expect(untouched.wrappedDekPassword).toBeUndefined();
  });

  it("still succeeds and migrates with the correct password when the legacy account has real stored data", async () => {
    const { migrateLegacyEnvelope, activateSessionKey, encryptJSON } = await import("./crypto");
    injectLegacyUser("legacy3@test.com", "real-password");
    const migrated = await migrateLegacyEnvelope("real-password", "legacy-id-1");
    activateSessionKey(migrated.dek);
    const encrypted = await encryptJSON(JSON.stringify({ real: "data" }));
    localStorage.setItem("essa_data_legacy-id-1", encrypted);

    const result = await signIn("legacy3@test.com", "real-password");
    expect(result.ok).toBe(true);
  });
});

describe("hasValidSession", () => {
  it("is true right after a normal sign-in (session + active key both present)", async () => {
    await signUp("a@test.com", "Alice", "password12345");
    await signIn("a@test.com", "password12345");
    expect(hasValidSession()).toBe(true);
  });

  it("is false with no session at all", () => {
    expect(hasValidSession()).toBe(false);
  });

  it("is false when a session exists but its per-tab encryption key doesn't — the browser-restart/fresh-tab gap this guard exists to close", async () => {
    await signUp("a@test.com", "Alice", "password12345");
    await signIn("a@test.com", "password12345");
    expect(getSession()).not.toBeNull(); // session (localStorage) is present

    const { clearEncryptionKey } = await import("./crypto");
    clearEncryptionKey(); // simulate sessionStorage being gone (browser restart / fresh tab)

    expect(hasValidSession()).toBe(false);
  });

  it("is false after signOut", async () => {
    await signUp("a@test.com", "Alice", "password12345");
    await signIn("a@test.com", "password12345");
    signOut();
    expect(hasValidSession()).toBe(false);
  });
});

describe("recoverAccount", () => {
  it("fails when the account hasn't been migrated/signed-in yet (no wrappedDekRecovery)", async () => {
    injectLegacyUser("legacy@test.com", "old-password");
    const result = await recoverAccount("legacy@test.com", "ANYT-HING-0000-0000", "newpassword1");
    expect(result).toEqual({
      ok: false,
      error: "Recovery isn't set up for this account yet. It needs one successful sign-in first.",
    });
  });

  it("fails with an unknown email when the server doesn't recognize it either", async () => {
    const result = await recoverAccount("nobody@test.com", "ANYT-HING-0000-0000", "newpassword1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No account found/);
  });

  it("recovers via the server when this email has no local account yet (e.g. a new device using its recovery code)", async () => {
    vi.mocked(relinkSync).mockResolvedValue({ ok: true });
    vi.mocked(pullFromServer).mockResolvedValue({
      ok: true,
      syncedAt: "2026-01-01T00:00:00.000Z",
      data: { ...(await import("./localData")).DEFAULT_DATA, userName: "Remote Name", income: 5000 },
    });
    const result = await recoverAccount("newdevice@test.com", "SOME-REAL-CODE-0000", "brandnewpassword1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.email).toBe("newdevice@test.com");
      expect(result.session.name).toBe("Remote Name");
      expect(result.newRecoveryCode).toBeTruthy();
      // A local account now exists for next time, provisioned from the pull.
      const users = listUsers();
      expect(users.some((u) => u.email === "newdevice@test.com")).toBe(true);
      // And the freshly-set password actually works afterward.
      const signInResult = await signIn("newdevice@test.com", "brandnewpassword1");
      expect(signInResult.ok).toBe(true);
    }
  });

  it("does not provision a local account when the server-side relink fails (unknown email or wrong recovery code)", async () => {
    await recoverAccount("nobody@test.com", "WRNG-0000-0000-0000", "newpassword1");
    expect(listUsers().some((u) => u.email === "nobody@test.com")).toBe(false);
  });

  it("fails with an incorrect recovery code", async () => {
    const reg = await signUp("a@test.com", "Alice", "password12345");
    expect(reg.ok).toBe(true);
    const result = await recoverAccount("a@test.com", "WRNG-0000-0000-0000", "newpassword1");
    expect(result).toEqual({ ok: false, error: "Invalid recovery code." });
  });

  it("rejects a new password under 10 characters even with a valid code", async () => {
    const reg = await signUp("a@test.com", "Alice", "password12345");
    if (!reg.ok) throw new Error("setup failed");
    const result = await recoverAccount("a@test.com", reg.recoveryCode, "abc");
    expect(result).toEqual({ ok: false, error: "Password must be at least 10 characters." });
  });

  it("succeeds with the correct recovery code, issues a new code, and the new password actually works afterward", async () => {
    const reg = await signUp("a@test.com", "Alice", "password12345");
    if (!reg.ok) throw new Error("setup failed");

    const result = await recoverAccount("a@test.com", reg.recoveryCode, "brandnewpassword");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newRecoveryCode).not.toBe(reg.recoveryCode);

    // Old password should no longer work; new password should.
    const oldPwAttempt = await signIn("a@test.com", "password12345");
    expect(oldPwAttempt.ok).toBe(false);
    const newPwAttempt = await signIn("a@test.com", "brandnewpassword");
    expect(newPwAttempt.ok).toBe(true);

    // Old recovery code should no longer work; the new one should.
    const oldCodeAttempt = await recoverAccount("a@test.com", reg.recoveryCode, "yetanotherpassword");
    expect(oldCodeAttempt.ok).toBe(false);
  });

  it("rotates the persisted recovery-sync token on every successful recovery (for the /relink fix)", async () => {
    const reg = await signUp("a@test.com", "Alice", "password12345");
    if (!reg.ok) throw new Error("setup failed");
    const beforeToken = getRecoveryTokenForSync("a@test.com");
    expect(beforeToken).toBeTruthy();

    const result = await recoverAccount("a@test.com", reg.recoveryCode, "brandnewpassword");
    expect(result.ok).toBe(true);

    const afterToken = getRecoveryTokenForSync("a@test.com");
    expect(afterToken).toBeTruthy();
    expect(afterToken).not.toBe(beforeToken);
  });
});

describe("session and admin helpers", () => {
  it("signOut clears the session", async () => {
    await signUp("a@test.com", "Alice", "password12345");
    await signIn("a@test.com", "password12345");
    expect(getSession()).not.toBeNull();
    signOut();
    expect(getSession()).toBeNull();
  });

  it("isAdmin reflects the first-account-is-admin rule", async () => {
    const reg = await signUp("a@test.com", "Alice", "password12345");
    if (!reg.ok) throw new Error("setup failed");
    const users = listUsers();
    expect(isAdmin(users[0].id)).toBe(true);
  });
});
