// Audit 2.4.165: log lines name an account by a KEYED reference, never by
// its address. Keyed, not a plain hash, because a plain hash of an email is
// reversible by guessing plausible addresses. The server holds the key and
// could check a candidate address, so "irreversible" is never the claim --
// only that a line can't be matched to an address WITHOUT the key.
//
// crypto is wrapped (behaviour unchanged) so the no-key tests can show that
// no hash is computed at all, not merely that none was returned.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "crypto";
import { emailRef, logKeyStatus, scrubAddresses, UNKEYED } from "../src/lib/emailRef";
import { logger } from "../src/lib/logger";

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return { ...actual, createHmac: vi.fn(actual.createHmac), createHash: vi.fn(actual.createHash) };
});

// Test keys, in the shape the owner is told to generate. Not secrets.
const KEY_1 = "0123456789abcdef".repeat(4);
const KEY_2 = "fedcba9876543210".repeat(4);
const ADDR = "logged-account@example.com";

// Computed independently of the code under test.
const hmacRef = (key: string, email: string) =>
  crypto.createHmac("sha256", key).update(email).digest("hex").slice(0, 16);
const plainHash = (email: string) => crypto.createHash("sha256").update(email).digest("hex");

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.LOG_EMAIL_KEY;
  process.env.LOG_EMAIL_KEY = KEY_1;
});
afterEach(() => {
  if (saved === undefined) delete process.env.LOG_EMAIL_KEY;
  else process.env.LOG_EMAIL_KEY = saved;
  vi.restoreAllMocks();
});

describe("the reference is keyed", () => {
  it("is the HMAC-SHA256 of the address under LOG_EMAIL_KEY, 16 hex characters", () => {
    expect(emailRef(ADDR)).toBe(hmacRef(KEY_1, ADDR));
    expect(emailRef(ADDR)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is the same for one address every time, after the normalisation emailSchema applies", () => {
    expect(emailRef(ADDR)).toBe(emailRef(ADDR));
    expect(emailRef("  Logged-Account@Example.com ")).toBe(emailRef(ADDR));
  });

  it("differs between addresses", () => {
    expect(emailRef("someone-else@example.com")).not.toBe(emailRef(ADDR));
  });

  it("differs under a different key -- so matching a guessed address needs the key", () => {
    const underKey1 = emailRef(ADDR);
    process.env.LOG_EMAIL_KEY = KEY_2;
    expect(emailRef(ADDR)).not.toBe(underKey1);
    expect(emailRef(ADDR)).toBe(hmacRef(KEY_2, ADDR));
  });

  it("is not a plain hash of the address -- the guessable form this replaces", () => {
    expect(plainHash(ADDR)).not.toContain(emailRef(ADDR));
  });
});

describe("no key, no reference", () => {
  // THE test that fails if a reference is ever computed without the key: for
  // every shape of unusable key, the result is the literal "unkeyed" AND no
  // HMAC or hash function ran at all.
  it.each([
    ["unset", undefined, "missing"],
    ["empty", "", "missing"],
    ["too short", "abc123", "malformed"],
    ["one character short", "x".repeat(31), "malformed"],
    ["leading space", ` ${KEY_1}`, "malformed"],
    ["trailing newline", `${KEY_1}\n`, "malformed"],
  ] as const)("%s: no reference is computed", (_label, value, status) => {
    if (value === undefined) delete process.env.LOG_EMAIL_KEY;
    else process.env.LOG_EMAIL_KEY = value;
    vi.mocked(crypto.createHmac).mockClear();
    vi.mocked(crypto.createHash).mockClear();

    expect(logKeyStatus()).toBe(status);
    expect(emailRef(ADDR)).toBe(UNKEYED);
    expect(scrubAddresses(`seen ${ADDR}`)).toBe(`seen [email:${UNKEYED}]`);
    expect(crypto.createHmac).not.toHaveBeenCalled();
    expect(crypto.createHash).not.toHaveBeenCalled();
  });

  it("the shortest usable key (32 characters) does produce a reference (the boundary's other side)", () => {
    process.env.LOG_EMAIL_KEY = "x".repeat(32);
    expect(logKeyStatus()).toBe("ok");
    expect(emailRef(ADDR)).toBe(hmacRef("x".repeat(32), ADDR));
  });
});

describe("the logger never writes an address, whatever the caller passes", () => {
  function lineOf(fn: () => void, stream: "stdout" | "stderr" = "stdout"): { raw: string; line: Record<string, unknown> } {
    const chunks: string[] = [];
    const target = stream === "stdout" ? process.stdout : process.stderr;
    const spy = vi.spyOn(target, "write").mockImplementation(((c: unknown) => { chunks.push(String(c)); return true; }) as never);
    try { fn(); } finally { spy.mockRestore(); }
    expect(chunks).toHaveLength(1); // premise: exactly one line was written
    return { raw: chunks[0], line: JSON.parse(chunks[0]) };
  }

  it("an address under any key, or inside any string, is written as its reference", () => {
    const ref = emailRef(ADDR);
    const { raw, line } = lineOf(() => logger.warn("x", { email: ADDR, note: `from ${ADDR}`, nested: { who: ADDR } }));
    expect(raw).not.toContain("logged-account");
    expect(line.email).toBe(`[email:${ref}]`);
    expect(line.note).toBe(`from [email:${ref}]`);
    expect(line.nested).toEqual({ who: `[email:${ref}]` });
  });

  it("an address quoted in an error's message or stack is replaced too", () => {
    const { raw, line } = lineOf(() => logger.error("boom", new Error(`lookup failed for ${ADDR}`)), "stderr");
    expect(raw).not.toContain("logged-account");
    expect(line.message).toBe(`lookup failed for [email:${emailRef(ADDR)}]`);
  });

  it("the whole local part goes, including characters zod accepts such as an apostrophe", () => {
    expect(scrubAddresses("o'brien.smith+tag@example.co.uk")).toBe(`[email:${emailRef("o'brien.smith+tag@example.co.uk")}]`);
  });

  it("stack-trace paths with an @ are left alone", () => {
    const frame = "at f (/app/node_modules/@prisma/client/runtime/library.js:1:2)";
    expect(scrubAddresses(frame)).toBe(frame);
  });

  it("the key never appears in a line", () => {
    const { raw } = lineOf(() => logger.warn("x", { email: ADDR }));
    expect(raw).not.toContain(KEY_1);
  });
});
