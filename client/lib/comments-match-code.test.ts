// CODE-04 (blind-spot audit): comments that state the opposite of what the
// code does -- "no callers" on the function every debt figure uses, "INERT"
// on the record the close writes. The next reader may skip code they think
// is unused, or "fix" code they think is unwired.
//
// Each test pairs the stale claim with the code fact that makes it false,
// so the claim can't quietly come back while the fact still holds.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
function sources(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(join(root, p)).isDirectory()) return f === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}
const app = [...sources("app"), ...sources("components"), ...sources("lib")];
/** Non-test files, other than the one that defines it, that call `name(`. */
const callers = (name: string, definedIn: string) =>
  app.filter((p) => p !== definedIn && new RegExp(`\\b${name}\\(`).test(read(p)));

const localData = read("lib/localData.ts");
const period = read("lib/period.ts");

describe("CODE-04: comments match the code", () => {
  it("the period-close record is written and read, so it isn't called inert", () => {
    expect(callers("buildPeriodClose", "lib/localData.ts").length).toBeGreaterThan(0);
    expect(localData).not.toMatch(/INERT AS OF PHASE 1\. Nothing writes it/);
    expect(localData).not.toMatch(/INERT: nothing writes this and nothing in the UI reads it/);
  });

  it("soft delete shipped, so nothing waits for 2.6.3 to wire it", () => {
    expect(callers("activeTransactions", "lib/localData.ts").length).toBeGreaterThan(0);
    expect(localData).not.toMatch(/once 2\.6\.3 wires/);
  });

  it("the derived balances have callers", () => {
    expect(callers("derivedDebtBalance", "lib/localData.ts").length).toBeGreaterThan(0);
    expect(callers("derivedEfBalance", "lib/localData.ts").length).toBeGreaterThan(0);
    expect(localData).not.toMatch(/this function has no callers/);
    expect(localData).not.toMatch(/No caller anywhere\s*\n?\s*\/\/\s*in the app uses these yet/);
  });

  it("the transaction merge engine is wired", () => {
    expect(callers("mergeTransactions", "lib/localData.ts").length).toBeGreaterThan(0);
    expect(localData).not.toMatch(/the sync merge engine, pure and unwired/);
  });

  it("the payday is user-set, so the period module isn't hardcoded to the 1st", () => {
    expect(callers("cycleStartDayOf", "lib/localData.ts").length).toBeGreaterThan(0);
    expect(period).not.toMatch(/PHASE 1 IS DELIBERATELY INERT/);
  });
});
