import { describe, it, expect, beforeEach } from "vitest";
import {
  createEnvelopes, migrateLegacyEnvelope, rewrapEnvelopes,
  unwrapWithPassword, unwrapWithRecoveryCode, generateRecoveryCode,
  activateSessionKey, clearEncryptionKey, encryptJSON, decryptJSON,
  deriveRecoveryToken,
} from "./crypto";

beforeEach(() => {
  sessionStorage.clear();
});

describe("generateRecoveryCode", () => {
  it("produces a 4x4 dash-grouped code from a restricted, unambiguous alphabet", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  });

  it("is randomized across calls", () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).not.toBe(b);
  });
});

describe("DEK envelope wrap/unwrap", () => {
  it("unwraps the same DEK with the correct password", async () => {
    const { dek, wrappedPassword } = await createEnvelopes("correct horse", "user-1");
    const unwrapped = await unwrapWithPassword("correct horse", "user-1", wrappedPassword);
    expect(unwrapped).not.toBeNull();
    expect(Buffer.from(unwrapped!)).toEqual(Buffer.from(dek));
  });

  it("unwraps the same DEK with the correct recovery code", async () => {
    const { dek, wrappedRecovery, recoveryCode } = await createEnvelopes("correct horse", "user-1");
    const unwrapped = await unwrapWithRecoveryCode(recoveryCode, "user-1", wrappedRecovery);
    expect(unwrapped).not.toBeNull();
    expect(Buffer.from(unwrapped!)).toEqual(Buffer.from(dek));
  });

  it("returns null for the wrong password", async () => {
    const { wrappedPassword } = await createEnvelopes("correct horse", "user-1");
    const unwrapped = await unwrapWithPassword("wrong password", "user-1", wrappedPassword);
    expect(unwrapped).toBeNull();
  });

  it("returns null for the wrong recovery code", async () => {
    const { wrappedRecovery } = await createEnvelopes("correct horse", "user-1");
    const unwrapped = await unwrapWithRecoveryCode("WRNG-0000-0000-0000", "user-1", wrappedRecovery);
    expect(unwrapped).toBeNull();
  });

  it("returns null when unwrapping with the right secret but the wrong userId (salt mismatch)", async () => {
    const { wrappedPassword } = await createEnvelopes("correct horse", "user-1");
    const unwrapped = await unwrapWithPassword("correct horse", "user-2", wrappedPassword);
    expect(unwrapped).toBeNull();
  });

  it("recovery code verification tolerates missing dashes, spaces, and case differences", async () => {
    const { wrappedRecovery, recoveryCode } = await createEnvelopes("correct horse", "user-1");
    const noDashes = recoveryCode.replace(/-/g, "");
    const lower = recoveryCode.toLowerCase();
    const spaced = recoveryCode.replace(/-/g, " ");
    for (const variant of [noDashes, lower, spaced]) {
      const unwrapped = await unwrapWithRecoveryCode(variant, "user-1", wrappedRecovery);
      expect(unwrapped).not.toBeNull();
    }
  });
});

describe("migrateLegacyEnvelope", () => {
  it("derives a DEK identical to what the old direct password-derivation scheme produced (existing encrypted data must keep decrypting)", async () => {
    // Replicates the OLD (pre-recovery-code) deriveKey() scheme independently:
    // PBKDF2 over the password with salt `essa-v1-${userId}`, exported raw.
    const password = "legacy-password";
    const userId = "legacy-user";
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    const oldKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode(`essa-v1-${userId}`), iterations: 120_000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const oldRaw = new Uint8Array(await crypto.subtle.exportKey("raw", oldKey));

    const migrated = await migrateLegacyEnvelope(password, userId);
    expect(Buffer.from(migrated.dek)).toEqual(Buffer.from(oldRaw));
  });

  it("also wraps the migrated DEK so it's unwrappable going forward via password and the new recovery code", async () => {
    const migrated = await migrateLegacyEnvelope("legacy-password", "legacy-user");
    const viaPassword = await unwrapWithPassword("legacy-password", "legacy-user", migrated.wrappedPassword);
    const viaRecovery = await unwrapWithRecoveryCode(migrated.recoveryCode, "legacy-user", migrated.wrappedRecovery);
    expect(Buffer.from(viaPassword!)).toEqual(Buffer.from(migrated.dek));
    expect(Buffer.from(viaRecovery!)).toEqual(Buffer.from(migrated.dek));
  });
});

describe("rewrapEnvelopes (password reset)", () => {
  it("re-wraps the same DEK under a new password and a new recovery code", async () => {
    const { dek } = await createEnvelopes("old password", "user-1");
    const rewrapped = await rewrapEnvelopes(dek, "new password", "user-1");
    const unwrapped = await unwrapWithPassword("new password", "user-1", rewrapped.wrappedPassword);
    expect(Buffer.from(unwrapped!)).toEqual(Buffer.from(dek));
  });

  it("invalidates the old recovery code — only the freshly issued one works", async () => {
    const { dek, recoveryCode: oldCode } = await createEnvelopes("pw", "user-1");
    const rewrapped = await rewrapEnvelopes(dek, "pw", "user-1");
    expect(rewrapped.recoveryCode).not.toBe(oldCode);
    const withOldCode = await unwrapWithRecoveryCode(oldCode, "user-1", rewrapped.wrappedRecovery);
    expect(withOldCode).toBeNull();
    const withNewCode = await unwrapWithRecoveryCode(rewrapped.recoveryCode, "user-1", rewrapped.wrappedRecovery);
    expect(withNewCode).not.toBeNull();
  });
});

describe("encryptJSON / decryptJSON", () => {
  it("round-trips plaintext through the active session key", async () => {
    const { dek } = await createEnvelopes("pw", "user-1");
    activateSessionKey(dek);
    const plaintext = JSON.stringify({ hello: "world", amount: 42 });
    const encrypted = await encryptJSON(plaintext);
    expect(encrypted).not.toBe(plaintext); // actually encrypted, not passed through
    const decrypted = await decryptJSON(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("passes plaintext JSON through unchanged when there's no active session key (migration path)", async () => {
    clearEncryptionKey();
    const plainJson = JSON.stringify({ notEncrypted: true });
    const result = await decryptJSON(plainJson);
    expect(result).toBe(plainJson);
  });

  it("encryptJSON throws instead of silently storing plaintext when there is no key (would otherwise overwrite real encrypted data with an unencrypted copy)", async () => {
    clearEncryptionKey();
    const plaintext = JSON.stringify({ a: 1 });
    await expect(encryptJSON(plaintext)).rejects.toThrow("ENCRYPTION_KEY_MISSING");
  });

  it("decryptJSON throws instead of silently returning a still-encrypted envelope when there is no key (would otherwise look like an empty account)", async () => {
    const { dek } = await createEnvelopes("pw", "user-1");
    activateSessionKey(dek);
    const encrypted = await encryptJSON(JSON.stringify({ real: "data" }));
    clearEncryptionKey();
    await expect(decryptJSON(encrypted)).rejects.toThrow("ENCRYPTION_KEY_MISSING");
  });

  it("decryptJSON throws on a genuine decrypt failure (wrong key) instead of returning garbage", async () => {
    const { dek } = await createEnvelopes("pw", "user-1");
    activateSessionKey(dek);
    const encrypted = await encryptJSON(JSON.stringify({ real: "data" }));
    const { dek: otherDek } = await createEnvelopes("other-pw", "user-2");
    activateSessionKey(otherDek);
    await expect(decryptJSON(encrypted)).rejects.toThrow("DECRYPT_FAILED");
  });
});

describe("hasActiveKey", () => {
  it("reflects whether a session key is currently active", async () => {
    const { hasActiveKey } = await import("./crypto");
    clearEncryptionKey();
    expect(hasActiveKey()).toBe(false);
    const { dek } = await createEnvelopes("pw", "user-1");
    activateSessionKey(dek);
    expect(hasActiveKey()).toBe(true);
  });
});

describe("verifyLegacyPassword", () => {
  it("returns null when the account has no stored data yet (nothing to verify against)", async () => {
    localStorage.clear();
    const { verifyLegacyPassword } = await import("./crypto");
    const result = await verifyLegacyPassword("any-password", "brand-new-legacy-user");
    expect(result).toBeNull();
  });

  it("returns true for the password that actually decrypts the account's stored data", async () => {
    localStorage.clear();
    const userId = "legacy-user-1";
    const password = "legacy-password";
    const migrated = await migrateLegacyEnvelope(password, userId);
    activateSessionKey(migrated.dek);
    const encrypted = await encryptJSON(JSON.stringify({ real: "legacy data" }));
    localStorage.setItem(`essa_data_${userId}`, encrypted);

    const { verifyLegacyPassword } = await import("./crypto");
    expect(await verifyLegacyPassword(password, userId)).toBe(true);
  });

  it("returns false for a wrong password even if it happened to pass a weaker checksum", async () => {
    localStorage.clear();
    const userId = "legacy-user-2";
    const password = "legacy-password";
    const migrated = await migrateLegacyEnvelope(password, userId);
    activateSessionKey(migrated.dek);
    const encrypted = await encryptJSON(JSON.stringify({ real: "legacy data" }));
    localStorage.setItem(`essa_data_${userId}`, encrypted);

    const { verifyLegacyPassword } = await import("./crypto");
    expect(await verifyLegacyPassword("a-completely-different-password", userId)).toBe(false);
  });
});

describe("deriveRecoveryToken", () => {
  it("is deterministic for the same code and email", async () => {
    const a = await deriveRecoveryToken("K7QM-4XPZ-9RTL-2WJC", "user@example.com");
    const b = await deriveRecoveryToken("K7QM-4XPZ-9RTL-2WJC", "user@example.com");
    expect(a).toBe(b);
  });

  it("canonicalizes the code the same way unwrapWithRecoveryCode does — formatting differences don't change the result", async () => {
    const a = await deriveRecoveryToken("K7QM-4XPZ-9RTL-2WJC", "user@example.com");
    const b = await deriveRecoveryToken("k7qm 4xpz-9rtl2wjc", "user@example.com");
    expect(a).toBe(b);
  });

  it("differs per email, so the same code can't be replayed against a different account", async () => {
    const a = await deriveRecoveryToken("K7QM-4XPZ-9RTL-2WJC", "user@example.com");
    const b = await deriveRecoveryToken("K7QM-4XPZ-9RTL-2WJC", "someone-else@example.com");
    expect(a).not.toBe(b);
  });

  it("differs from a completely different recovery code", async () => {
    const a = await deriveRecoveryToken("K7QM-4XPZ-9RTL-2WJC", "user@example.com");
    const b = await deriveRecoveryToken("ZZZZ-ZZZZ-ZZZZ-ZZZZ", "user@example.com");
    expect(a).not.toBe(b);
  });
});
