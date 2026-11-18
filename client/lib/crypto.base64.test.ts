// Item 5 (owner, session 57; R4's plan item 7, its first step): encryption speed. toB64 turned the encrypted copy into
// text with a loop over 32 KB chunks and btoa: about 280 ms of the 481 ms the encryption took on a throttled phone at
// 13,500 entries (session 55's profile). Where the browser has its own Uint8Array.prototype.toBase64 (MDN: Baseline
// 2025), toB64 uses it; elsewhere, the loop as before. The text is the same either way (the standard alphabet, with
// padding), so what is stored doesn't change.
import { describe, it, expect, vi, afterEach } from "vitest";
import { toB64 } from "./crypto";

type Proto = { toBase64?: (this: Uint8Array) => string };
const proto = Uint8Array.prototype as unknown as Proto;
const own = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "toBase64");
afterEach(() => {
  if (own) Object.defineProperty(Uint8Array.prototype, "toBase64", own);
  else delete proto.toBase64;
});

/** The loop toB64 has always run (the reference). */
function loop(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(binary);
}
const LENGTHS = [0, 1, 2, 3, 31, 32768, 100000];
const bytesOf = (len: number) => { const b = new Uint8Array(len); for (let i = 0; i < len; i++) b[i] = (i * 151 + 7) % 256; return b; };

describe("toB64", () => {
  it("uses the browser's own base64 when it has one, and the text is the loop's", () => {
    const spy = vi.fn(function (this: Uint8Array) { return loop(this); });
    Object.defineProperty(Uint8Array.prototype, "toBase64", { value: spy, configurable: true, writable: true });
    for (const len of LENGTHS) expect(toB64(bytesOf(len)), String(len)).toBe(loop(bytesOf(len)));
    expect(spy).toHaveBeenCalledTimes(LENGTHS.length);
  });

  it("without one, the loop runs as before", () => {
    delete proto.toBase64;
    Object.defineProperty(Uint8Array.prototype, "toBase64", { value: undefined, configurable: true, writable: true });
    for (const len of LENGTHS) expect(toB64(bytesOf(len)), String(len)).toBe(loop(bytesOf(len)));
  });

  it.runIf(typeof own?.value === "function")("this runtime's own toBase64 gives the loop's text", () => {
    for (const len of LENGTHS) expect(toB64(bytesOf(len)), String(len)).toBe(loop(bytesOf(len)));
  });
});
