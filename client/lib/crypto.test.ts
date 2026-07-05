import { describe, it, expect, beforeEach } from "vitest";
import {
  createEnvelopes, migrateLegacyEnvelope, rewrapEnvelopes,
  unwrapWithPassword, unwrapWithRecoveryCode, generateRecoveryCode,
  activateSessionKey, clearEncryptionKey, encryptJSON, decryptJSON,
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

  it("encryptJSON stores plaintext as-is when there is no key yet (will encrypt on next save)", async () => {
    clearEncryptionKey();
    const plaintext = JSON.stringify({ a: 1 });
    const result = await encryptJSON(plaintext);
    expect(result).toBe(plaintext);
  });
});
