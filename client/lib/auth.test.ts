import { describe, it, expect, beforeEach, vi } from "vitest";
import { signUp, signIn, recoverAccount, deleteAccount, getSession, hasValidSession, signOut, isAdmin, listUsers, getRecoveryTokenForSync, type StoredUser } from "./auth";
import { pullFromServer, relinkSync, confirmOverwriteIfNeeded, deleteFromServer } from "./syncService";
import { initSyncToken } from "./crypto";

vi.mock("./syncService", () => ({
  pullFromServer: vi.fn(),
  relinkSync: vi.fn(),
  getRecoveryTokenForSync: vi.fn(),
  confirmOverwriteIfNeeded: vi.fn(),
  deleteFromServer: vi.fn(),
}));

const USERS_KEY = "essa_users_v1";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(pullFromServer).mockReset();
  vi.mocked(relinkSync).mockReset();
  vi.mocked(confirmOverwriteIfNeeded).mockReset();
  vi.mocked(deleteFromServer).mockReset();
  // Default: no synced data anywhere — matches signIn's "no local account,
  // and nothing to pull either" case unless a test overrides this.
  vi.mocked(pullFromServer).mockResolvedValue({ ok: false, error: "No data on server yet. Push first." });
  // Default: recoverAccount's sync fallback (recoverFromSync) finds no
  // matching account/recovery-code server-side either, unless overridden.
  vi.mocked(relinkSync).mockResolvedValue({ ok: false, error: "Could not verify ownership of this account's sync data." });
  // Default: the 2.4.37 overwrite guard allows the operation to proceed —
  // most existing tests here predate that guard and aren't testing it, so
  // they should behave exactly as before unless a test explicitly overrides
  // this to exercise the guard itself.
  vi.mocked(confirmOverwriteIfNeeded).mockResolvedValue(true);
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
      hasRecoveryCode: false,
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

  it("surfaces a recovery code on a new-device sign-in only when the account has none registered server-side yet", async () => {
    vi.mocked(pullFromServer).mockResolvedValue({
      ok: true,
      syncedAt: "2026-01-01T00:00:00.000Z",
      data: (await import("./localData")).DEFAULT_DATA,
      hasRecoveryCode: false,
    });
    const result = await signIn("firstdevice@test.com", "password12345");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("does NOT surface a recovery code on a new-device sign-in when the account already has one registered server-side (the reported bug: a fresh code shown on every new device)", async () => {
    vi.mocked(pullFromServer).mockResolvedValue({
      ok: true,
      syncedAt: "2026-01-01T00:00:00.000Z",
      data: (await import("./localData")).DEFAULT_DATA,
      hasRecoveryCode: true,
    });
    const result = await signIn("seconddevice@test.com", "password12345");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recoveryCode).toBeUndefined();
      // Still provisions a real local account (and its own local wrapped-DEK
      // envelope under the hood) -- only the modal-triggering code is suppressed.
      const users = listUsers();
      expect(users.some((u) => u.email === "seconddevice@test.com")).toBe(true);
    }
  });

  it("BUG regression (2.4.37): a new-device sign-in asks before overwriting if this browser already holds SOME account's real local data, and aborts cleanly if declined", async () => {
    vi.mocked(pullFromServer).mockResolvedValue({
      ok: true,
      syncedAt: "2026-01-01T00:00:00.000Z",
      data: { ...(await import("./localData")).DEFAULT_DATA, userName: "Remote Name", income: 5000 },
      hasRecoveryCode: false,
    });
    vi.mocked(confirmOverwriteIfNeeded).mockResolvedValue(false); // user declines
    const result = await signIn("newdevice@test.com", "password12345");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Cancelled/);
    // No local account was provisioned for this email — the guard fired
    // before any local write, not after.
    expect(listUsers().some((u) => u.email === "newdevice@test.com")).toBe(false);
    // signInFromSync has no established userId yet at this point — must use
    // the coarse (undefined) check, not a guessed/premature one.
    expect(confirmOverwriteIfNeeded).toHaveBeenCalledWith(undefined, expect.any(String));
  });

  it("proceeds normally when the guard finds nothing to protect, or the user accepts — unaffected by 2.4.37's addition", async () => {
    vi.mocked(pullFromServer).mockResolvedValue({
      ok: true,
      syncedAt: "2026-01-01T00:00:00.000Z",
      data: { ...(await import("./localData")).DEFAULT_DATA, userName: "Remote Name", income: 5000 },
      hasRecoveryCode: false,
    });
    vi.mocked(confirmOverwriteIfNeeded).mockResolvedValue(true);
    const result = await signIn("newdevice2@test.com", "password12345");
    expect(result.ok).toBe(true);
    expect(listUsers().some((u) => u.email === "newdevice2@test.com")).toBe(true);
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
      hasRecoveryCode: true,
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
    vi.mocked(relinkSync).mockResolvedValue({ ok: true }); // required now, not fire-and-forget

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
    vi.mocked(relinkSync).mockResolvedValue({ ok: true }); // required now, not fire-and-forget

    const result = await recoverAccount("a@test.com", reg.recoveryCode, "brandnewpassword");
    expect(result.ok).toBe(true);

    const afterToken = getRecoveryTokenForSync("a@test.com");
    expect(afterToken).toBeTruthy();
    expect(afterToken).not.toBe(beforeToken);
  });

  // 2026-08-18 redesign: recoverAccount no longer depends on a locally-cached
  // recoveryTokenForSync to decide whether (or how) to relink -- it derives
  // the proof fresh from the code just typed, every time, and falls back to
  // a server-verified path when this device's own envelope doesn't unwrap.
  // Covers every device state from docs/AUDIT_2026-08.md's Amendment 3 table.

  it("derives the relink proof from the typed code itself, not any locally-cached value (state A -- original device, unaffected in outcome but changed in mechanism)", async () => {
    const reg = await signUp("e@test.com", "Eve", "password12345");
    if (!reg.ok) throw new Error("setup failed");
    vi.mocked(relinkSync).mockResolvedValue({ ok: true });

    await recoverAccount("e@test.com", reg.recoveryCode, "brandnewpassword1");

    const { deriveRecoveryToken } = await import("./crypto");
    const expectedOldToken = await deriveRecoveryToken(reg.recoveryCode, "e@test.com");
    expect(relinkSync).toHaveBeenCalledWith("e@test.com", expect.any(String), expect.any(String), expectedOldToken);
  });

  it("reports a real failure when the server-side relink fails, instead of silently succeeding locally (state A -- the core 2.2.11 bug this replaces)", async () => {
    const reg = await signUp("d@test.com", "Dana", "password12345");
    if (!reg.ok) throw new Error("setup failed");
    vi.mocked(relinkSync).mockResolvedValue({ ok: false, error: "Could not reach server." });

    const result = await recoverAccount("d@test.com", reg.recoveryCode, "brandnewpassword1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/wasn't reset/);

    // Nothing was actually changed locally -- the old password still works,
    // proving this isn't "succeeded locally, server just didn't know" (the
    // old fire-and-forget behavior) but a real, reported failure.
    const oldPwStillWorks = await signIn("d@test.com", "password12345");
    expect(oldPwStillWorks.ok).toBe(true);
  });

  it("recovers a legacy-migrated device even though migration never registered recoveryTokenForSync (state C -- 2.2.11, closed for this device shape)", async () => {
    injectLegacyUser("legacy@test.com", "old-password");
    const signInResult = await signIn("legacy@test.com", "old-password");
    expect(signInResult.ok).toBe(true);
    if (!signInResult.ok) return;
    const realCode = signInResult.recoveryCode!;
    expect(realCode).toBeTruthy();
    // Confirms the precondition this test actually exercises: migration
    // never sets the local cache the OLD gate depended on.
    expect(getRecoveryTokenForSync("legacy@test.com")).toBeUndefined();

    vi.mocked(relinkSync).mockResolvedValue({ ok: true });
    const result = await recoverAccount("legacy@test.com", realCode, "brandnewpassword1");
    expect(result.ok).toBe(true);

    // The key regression check: relink was actually attempted here. Under
    // the old code, `if (user.recoveryTokenForSync)` was false for this
    // device shape, so this call was silently skipped entirely -- the
    // server's authTokenHash never rotated.
    expect(relinkSync).toHaveBeenCalled();

    const signInAfter = await signIn("legacy@test.com", "brandnewpassword1");
    expect(signInAfter.ok).toBe(true);
  });

  it("recovers a device that joined via signInFromSync (Pull), replacing its mismatched local record instead of duplicating it (state B -- 2.2.12, the reported bug)", async () => {
    // Provision this device the normal "new phone, existing account" way:
    // signInFromSync mints its OWN local recovery-code wrapper, unrelated
    // to whatever code the real account owner actually saved (see 2.2.12).
    vi.mocked(pullFromServer).mockResolvedValue({
      ok: true,
      syncedAt: "2026-01-01T00:00:00.000Z",
      data: { ...(await import("./localData")).DEFAULT_DATA, userName: "Existing Data", income: 4000 },
      hasRecoveryCode: true,
    });
    const signInResult = await signIn("b@test.com", "originalpassword1");
    expect(signInResult.ok).toBe(true);
    const before = listUsers();
    expect(before).toHaveLength(1);
    const originalId = before[0].id;

    // Recover using the account's REAL code. This device's own
    // wrappedDekRecovery was never wrapped under it (it has its own,
    // internally-generated one), so local unwrap must fail here regardless
    // of which code is passed in -- exactly the bug reported live.
    vi.mocked(relinkSync).mockResolvedValue({ ok: true });
    vi.mocked(pullFromServer).mockResolvedValue({
      ok: true,
      syncedAt: "2026-01-02T00:00:00.000Z",
      data: { ...(await import("./localData")).DEFAULT_DATA, userName: "Existing Data", income: 4000 },
      hasRecoveryCode: true,
    });
    const result = await recoverAccount("b@test.com", "THE-REAL-SAVED-CODE-0000", "brandnewpassword1");
    expect(result.ok).toBe(true);

    // Replaced in place, not duplicated into a second record for this email.
    const after = listUsers();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(originalId);
    expect(after[0].email).toBe("b@test.com");

    // The new password actually works on this device now.
    const signInAfter = await signIn("b@test.com", "brandnewpassword1");
    expect(signInAfter.ok).toBe(true);
  });

  it("BUG regression (2.4.37): recovering a device with an existing local record asks before overwriting it, using that record's OWN id -- not the coarse check -- and aborts cleanly if declined", async () => {
    // Same state-B setup as the test above: a local record already exists
    // for this email (joined via signInFromSync earlier), so recoverFromSync
    // runs with `existingId` set -- the precise-check branch, not the
    // coarse one signInFromSync itself uses.
    vi.mocked(pullFromServer).mockResolvedValue({
      ok: true, syncedAt: "2026-01-01T00:00:00.000Z",
      data: { ...(await import("./localData")).DEFAULT_DATA, userName: "Existing Data", income: 4000 },
      hasRecoveryCode: true,
    });
    const signInResult = await signIn("d@test.com", "originalpassword1");
    expect(signInResult.ok).toBe(true);
    const originalId = listUsers()[0].id;

    vi.mocked(relinkSync).mockResolvedValue({ ok: true });
    vi.mocked(confirmOverwriteIfNeeded).mockResolvedValue(false); // user declines this time
    const result = await recoverAccount("d@test.com", "THE-REAL-SAVED-CODE-0000", "brandnewpassword1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Cancelled/);

    // The precise check was used, keyed on the EXISTING local record's own
    // id -- not undefined (the coarse case) and not some other id.
    expect(confirmOverwriteIfNeeded).toHaveBeenCalledWith(originalId, expect.any(String));
    // Nothing about the existing local record changed -- the old password
    // still works, proving the record was never replaced.
    const signInStill = await signIn("d@test.com", "originalpassword1");
    expect(signInStill.ok).toBe(true);
  });

  it("still reports 'Invalid recovery code' -- not a generic account-not-found message -- when a joined-via-Pull device's fallback also gets a wrong code", async () => {
    vi.mocked(pullFromServer).mockResolvedValue({
      ok: true, syncedAt: "2026-01-01T00:00:00.000Z",
      data: (await import("./localData")).DEFAULT_DATA, hasRecoveryCode: true,
    });
    await signIn("c@test.com", "originalpassword1");

    // relinkSync's default mock (see beforeEach) already returns the
    // "verify ownership" failure -- simulating a genuinely wrong code, not
    // a network problem.
    const result = await recoverAccount("c@test.com", "WRONG-CODE-0000-0000", "brandnewpassword1");
    expect(result).toEqual({ ok: false, error: "Invalid recovery code." });

    // And nothing was provisioned/replaced on a failed attempt.
    const users = listUsers();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("c@test.com");
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

describe("deleteAccount (2.2.18 -- server-cleanup result is reported, not swallowed)", () => {
  it("deletes the account locally and reports serverCleanupOk: true when there's no sync token (never synced)", async () => {
    const reg = await signUp("a@test.com", "Alice", "password12345");
    if (!reg.ok) throw new Error("setup failed");
    const userId = listUsers()[0].id;

    const result = await deleteAccount(userId);

    expect(result).toEqual({ serverCleanupOk: true });
    expect(listUsers()).toEqual([]);
    expect(deleteFromServer).not.toHaveBeenCalled();
  });

  it("reports serverCleanupOk: true when the server delete succeeds", async () => {
    const reg = await signUp("a@test.com", "Alice", "password12345");
    if (!reg.ok) throw new Error("setup failed");
    const userId = listUsers()[0].id;
    await initSyncToken("password12345", "a@test.com");
    vi.mocked(deleteFromServer).mockResolvedValue({ ok: true });

    const result = await deleteAccount(userId);

    expect(result).toEqual({ serverCleanupOk: true });
    expect(deleteFromServer).toHaveBeenCalledWith("a@test.com", expect.any(String));
  });

  it("still deletes locally but reports serverCleanupOk: false when the server delete fails -- this used to be swallowed entirely", async () => {
    const reg = await signUp("a@test.com", "Alice", "password12345");
    if (!reg.ok) throw new Error("setup failed");
    const userId = listUsers()[0].id;
    await initSyncToken("password12345", "a@test.com");
    vi.mocked(deleteFromServer).mockResolvedValue({ ok: false, error: "Could not reach server." });

    const result = await deleteAccount(userId);

    expect(result).toEqual({ serverCleanupOk: false });
    expect(listUsers()).toEqual([]); // local deletion isn't gated on the server result
  });
});
