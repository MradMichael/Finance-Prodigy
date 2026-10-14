// CODE-05's remainder (plan J, session 22; HELD): the live rate was read as
// `x.lbpRate ?? DEFAULT_LBP_RATE` in 49 places (a 0 or NaN rate passes
// through `??`), and seven screens wrote their own lira converter. The rate
// is now read through lbpRateOf (guarded by rateOrDefault, "the single place
// that decides whether an LBP rate is usable"), and the live converter is
// one shared makeToUSDLive, so a fix to one is a fix to all.
import { it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { lbpRateOf, makeToUSDLive, DEFAULT_LBP_RATE, DEFAULT_DATA, type LocalFinancials } from "./localData";

const root = join(__dirname, "..");
const sources = () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e) && !/\.test\./.test(e)) files.push(p); } };
  for (const d of ["app", "components", "lib"]) walk(join(root, d));
  return files;
};
const lines = (re: RegExp) => sources().flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => (re.test(l) ? `${relative(root, f).replace(/\\/g, "/")}:${i + 1}` : null)).filter(Boolean));

it("no code reads the live rate as `?? DEFAULT_LBP_RATE`; it goes through lbpRateOf", () => {
  expect(lines(/\?\?\s*DEFAULT_LBP_RATE/)).toEqual([]);
});

it("no screen writes its own lira converter; it uses the shared one", () => {
  expect(lines(/const toUSD\s*=\s*\(\s*\w+:\s*number,\s*cur\??:/)).toEqual([]);
});

it("lbpRateOf guards a rate that can't be used, and makeToUSDLive converts at it", () => {
  const at = (lbpRate: number) => ({ ...DEFAULT_DATA, lbpRate }) as LocalFinancials;
  expect(lbpRateOf(at(100_000))).toBe(100_000);
  expect(lbpRateOf(at(0))).toBe(DEFAULT_LBP_RATE);
  expect(lbpRateOf(at(Number.NaN))).toBe(DEFAULT_LBP_RATE);
  expect(makeToUSDLive(at(100_000))(1_000_000, "LBP")).toBe(10);
  expect(makeToUSDLive(at(100_000))(25, "USD")).toBe(25);
});
