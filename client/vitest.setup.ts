// jsdom's Crypto implements getRandomValues but not SubtleCrypto, so
// crypto.subtle is undefined by default under the jsdom test environment —
// patch it with Node's real WebCrypto implementation so client/lib/crypto.ts
// and client/lib/auth.ts (both PBKDF2/AES-GCM via crypto.subtle) work in tests
// exactly as they do in a real browser.
import { webcrypto } from "node:crypto";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}
