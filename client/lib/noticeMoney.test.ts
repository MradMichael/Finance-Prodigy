// Session 52 (owner, R12): one negative format. noticeMoney's dollars already read "-$150" (Intl); its lira read
// "L£-150,000". The sign goes first for both.
import { it, expect } from "vitest";
import { noticeMoney } from "./noticeMoney";

it("amounts at or above zero are as they were", () => {
  expect(noticeMoney(150, "USD")).toBe("$150");
  expect(noticeMoney(150_000, "LBP")).toBe("L£150,000");
  expect(noticeMoney(150, undefined)).toBe("$150");
});

it("a negative amount has its sign before the symbol, in both currencies", () => {
  expect(noticeMoney(-150, "USD")).toBe("-$150");
  expect(noticeMoney(-150_000, "LBP")).toBe("-L£150,000");
});
