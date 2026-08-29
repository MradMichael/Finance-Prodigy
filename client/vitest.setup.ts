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

// VER-05 (external audit, 2026-08-28): @testing-library/react added so
// component-level logic (previously untestable under Standing Rule 4 --
// AUD-01/AUD-02/AUD-09 all hit this exact gap) can get real, CI-run
// regression tests instead of relying on a one-off local Playwright check
// that proves a fix works today but provides no protection against it
// silently regressing later.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL's auto-cleanup only self-registers under a Jest-detected global
// afterEach; under Vitest it doesn't fire on its own, so without this every
// component test after the first would render into a jsdom document that
// still has the previous test's tree in it -- confirmed directly the first
// time this was wired in (two failures: a stale "Admin panel" from a prior
// test's render still in the DOM, then a "found multiple elements" error
// once a second render piled on top of it).
afterEach(() => {
  cleanup();
});
