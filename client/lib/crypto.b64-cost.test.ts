// R2/R4 (session 51 review): on a mid-range phone (CPU 4x slower) with 1,500 entries, opening the app
// spent 315-329 ms in fromB64, which made one callback per byte (Uint8Array.from with a map function), and
// adding an entry spent 164 ms in toB64, which spread each 32 KB chunk through the array iterator. Neither
// path is taken now. The output is unchanged: crypto.test.ts compares both with Node's own base64 at every
// chunk boundary and at 8 MB.
import { describe, it, expect, vi, afterEach } from "vitest";
import { toB64, fromB64 } from "./crypto";

afterEach(() => vi.restoreAllMocks());

const pattern = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 255; return b; };

describe("base64 without a per-byte path", () => {
  it("fromB64 decodes without Uint8Array.from and its per-byte callback", () => {
    const b64 = Buffer.from(pattern(70_000)).toString("base64");
    const spy = vi.spyOn(Uint8Array, "from");
    const out = fromB64(b64);
    expect(spy).not.toHaveBeenCalled();
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(out).equals(Buffer.from(pattern(70_000)))).toBe(true);
  });

  it("toB64 hands each chunk over without walking the iterator", () => {
    const bytes = pattern(70_000);
    const spy = vi.spyOn(Uint8Array.prototype, Symbol.iterator);
    const b64 = toB64(bytes);
    expect(spy).not.toHaveBeenCalled();
    expect(b64).toBe(Buffer.from(bytes).toString("base64"));
  });
});
