import { describe, it, expect, beforeEach } from "vitest";
import { signUp, signIn, recoverAccount, getSession, signOut, isAdmin, listUsers, getRecoveryTokenForSync, type StoredUser } from "./auth";

const USERS_KEY = "essa_users_v1";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
    const result = await signUp("a@test.com", "Alice", "password1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("rejects a password under 6 characters", async () => {
    const result = await signUp("a@test.com", "Alice", "abc");
    expect(result).toEqual({ ok: false, error: "Password must be at least 6 characters." });
  });

  it("rejects missing fields", async () => {
    const result = await signUp("", "Alice", "password1");
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicate email (case-insensitive)", async () => {
    await signUp("a@test.com", "Alice", "password1");
    const result = await signUp("A@TEST.COM", "Alice2", "password2");
    expect(result).toEqual({ ok: false, error: "An account with this email already exists." });
  });

  it("makes the first registered account an admin, and later ones not", async () => {
    await signUp("first@test.com", "First", "password1");
    await signUp("second@test.com", "Second", "password2");
    const users = listUsers();
    const first = users.find((u) => u.email === "first@test.com")!;
    const second = users.find((u) => u.email === "second@test.com")!;
    expect(first.isAdmin).toBe(true);
    expect(second.isAdmin).toBeFalsy();
  });
});

describe("signIn", () => {
  it("rejects an email with no account", async () => {
    const result = await signIn("nobody@test.com", "password1");
    expect(result).toEqual({ ok: false, error: "No account found with this email." });
  });

  it("rejects the wrong password", async () => {
    await signUp("a@test.com", "Alice", "password1");
    const result = await signIn("a@test.com", "wrong-password");
    expect(result).toEqual({ ok: false, error: "Incorrect password." });
  });

  it("succeeds with the correct password and establishes a session", async () => {
    await signUp("a@test.com", "Alice", "password1");
    const result = await signIn("a@test.com", "password1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.email).toBe("a@test.com");
      expect(getSession()?.email).toBe("a@test.com");
    }
  });

  it("does not surface a recoveryCode on an ordinary sign-in (only on first-time migration)", async () => {
    await signUp("a@test.com", "Alice", "password1");
    const result = await signIn("a@test.com", "password1");
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
});

describe("recoverAccount", () => {
  it("fails when the account hasn't been migrated/signed-in yet (no wrappedDekRecovery)", async () => {
    injectLegacyUser("legacy@test.com", "old-password");
    const result = await recoverAccount("legacy@test.com", "ANYT-HING-0000-0000", "newpassword1");
    expect(result).toEqual({
      ok: false,
      error: "Recovery isn't set up for this account yet — it needs one successful sign-in first.",
    });
  });

  it("fails with an unknown email", async () => {
    const result = await recoverAccount("nobody@test.com", "ANYT-HING-0000-0000", "newpassword1");
    expect(result).toEqual({ ok: false, error: "No account found with this email." });
  });

  it("fails with an incorrect recovery code", async () => {
    const reg = await signUp("a@test.com", "Alice", "password1");
    expect(reg.ok).toBe(true);
    const result = await recoverAccount("a@test.com", "WRNG-0000-0000-0000", "newpassword1");
    expect(result).toEqual({ ok: false, error: "Invalid recovery code." });
  });

  it("rejects a new password under 6 characters even with a valid code", async () => {
    const reg = await signUp("a@test.com", "Alice", "password1");
    if (!reg.ok) throw new Error("setup failed");
    const result = await recoverAccount("a@test.com", reg.recoveryCode, "abc");
    expect(result).toEqual({ ok: false, error: "Password must be at least 6 characters." });
  });

  it("succeeds with the correct recovery code, issues a new code, and the new password actually works afterward", async () => {
    const reg = await signUp("a@test.com", "Alice", "password1");
    if (!reg.ok) throw new Error("setup failed");

    const result = await recoverAccount("a@test.com", reg.recoveryCode, "brandnewpassword");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newRecoveryCode).not.toBe(reg.recoveryCode);

    // Old password should no longer work; new password should.
    const oldPwAttempt = await signIn("a@test.com", "password1");
    expect(oldPwAttempt.ok).toBe(false);
    const newPwAttempt = await signIn("a@test.com", "brandnewpassword");
    expect(newPwAttempt.ok).toBe(true);

    // Old recovery code should no longer work; the new one should.
    const oldCodeAttempt = await recoverAccount("a@test.com", reg.recoveryCode, "yetanotherpassword");
    expect(oldCodeAttempt.ok).toBe(false);
  });

  it("rotates the persisted recovery-sync token on every successful recovery (for the /relink fix)", async () => {
    const reg = await signUp("a@test.com", "Alice", "password1");
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
    await signUp("a@test.com", "Alice", "password1");
    await signIn("a@test.com", "password1");
    expect(getSession()).not.toBeNull();
    signOut();
    expect(getSession()).toBeNull();
  });

  it("isAdmin reflects the first-account-is-admin rule", async () => {
    const reg = await signUp("a@test.com", "Alice", "password1");
    if (!reg.ok) throw new Error("setup failed");
    const users = listUsers();
    expect(isAdmin(users[0].id)).toBe(true);
  });
});
