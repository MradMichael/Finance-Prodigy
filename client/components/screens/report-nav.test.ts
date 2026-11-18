// F4 (owner, session 56; held): the Monthly report is a screen of its own, under More (the phone's panel lists
// every NAV screen; the sidebar too), loaded on first use like the other screens and preloaded once idle.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "./shared";

const src = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

it("NAV lists it as \"Monthly report\", after Statistics", () => {
  const keys = NAV.map((n) => n.key);
  expect(NAV.find((n) => n.key === "report")?.label).toBe("Monthly report");
  expect(keys.indexOf("report")).toBe(keys.indexOf("statistics") + 1);
});

it("it loads on first use and is preloaded with the others; the page shows it", () => {
  const lazy = src("app/screens.lazy.tsx");
  expect(lazy).toMatch(/export const MonthlyReportScreen = lazyScreen\(\(\) => import\("\.\.\/components\/screens\/MonthlyReportScreen"\)\);/);
  expect(lazy).toMatch(/const ALL = \[[^\]]*\bMonthlyReportScreen\b[^\]]*\]/);
  expect(src("app/screens.sync.tsx")).toMatch(/export \{ default as MonthlyReportScreen \} from "\.\.\/components\/screens\/MonthlyReportScreen";/);
  expect(src("app/page.tsx")).toMatch(/\{screen === "report" +&& <MonthlyReportScreen financials=\{financials\} \/>\}/);
});
