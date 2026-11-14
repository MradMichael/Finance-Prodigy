// R1/R2 (session 32 review): money() built a new Intl.NumberFormat on every call, and fmtCur() called
// toLocaleString with options, which builds one internally -- 481 ms a render at 15,000 entries. Each now
// uses a formatter built once. The strings must not change by a character.
import { describe, it, expect, vi, afterEach } from "vitest";
import { money, fmtCur } from "./shared";

afterEach(() => vi.restoreAllMocks());

// The expressions as they were (session 31), as the reference.
const oldMoney = (n: number, d = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d }).format(n);
const oldFmtCur = (amt: number, cur: "USD" | "LBP") => cur === "LBP"
  ? `L£${amt.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
  : `$${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const VALUES = [0, -0, 1, -1, 0.005, 0.015, 0.5, 1.005, 2.675, -105.5, 1234.5, 999999.995, 8950000, -8950000, 1e9, 12.3456, 89500 * 0.37, NaN];

describe("formatters built once", () => {
  it("money() builds no formatter per call", () => {
    money(1); money(1, 2); // whatever is built on first use is built here
    const spy = vi.spyOn(Intl, "NumberFormat");
    for (let i = 0; i < 2000; i++) money(i * 1.37, i % 3 === 0 ? 2 : 0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("fmtCur() calls toLocaleString no more", () => {
    fmtCur(1, "USD"); fmtCur(1, "LBP");
    const spy = vi.spyOn(Number.prototype, "toLocaleString");
    for (let i = 0; i < 2000; i++) fmtCur(i * 1.37, i % 2 ? "USD" : "LBP");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the strings are exactly what they were", () => {
  it("money(), with 0 and 2 fraction digits", () => {
    for (const v of VALUES) {
      expect(money(v)).toBe(oldMoney(v));
      expect(money(v, 2)).toBe(oldMoney(v, 2));
    }
  });

  // Session 52 (owner, R12): a negative amount reads "-$2,336.78", the sign before the symbol, as money() and every
  // Intl-formatted figure already did; it used to read "$-2,336.78". Everything at or above zero is as it was.
  it("fmtCur(), in both currencies: unchanged at or above zero", () => {
    for (const v of VALUES.filter((n) => !(n < 0) && !Object.is(n, -0))) {
      expect(fmtCur(v, "USD")).toBe(oldFmtCur(v, "USD"));
      expect(fmtCur(v, "LBP")).toBe(oldFmtCur(v, "LBP"));
    }
  });

  it("fmtCur(): a negative amount has its sign before the symbol", () => {
    expect(fmtCur(-2336.78, "USD")).toBe("-$2,336.78");
    expect(fmtCur(-1, "USD")).toBe("-$1.00");
    expect(fmtCur(-105.5, "USD")).toBe("-$105.50");
    expect(fmtCur(-8950000, "LBP")).toBe("-L£8,950,000");
    expect(fmtCur(-1, "LBP")).toBe("-L£1");
    for (const v of VALUES) for (const c of ["USD", "LBP"] as const) expect(fmtCur(v, c)).not.toMatch(/[$£]-/);
  });

  it("fmtCur(): negative zero is zero", () => {
    expect(fmtCur(-0, "USD")).toBe("$0.00");
    expect(fmtCur(-0, "LBP")).toBe("L£0");
  });
});
