// Q26 (owner, session 22): dates are DD/MM/YYYY everywhere, in English, and
// money uses comma thousands. COPY-10 found three date formats (29/09/2026,
// 29-03-2027, "01 Oct"); CODE-01 found money and dates formatted with no
// locale, so an Arabic or French browser showed one amount two ways. Single
// days now all read DD/MM/YYYY. Period names (a cycle's "27 Sep – 26 Oct",
// a month's "Oct 2026") are the owner's earlier decision (2026-09-14) and
// stay as they are.
import { it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { dateFmt, computeDashboard } from "./computeDashboard";
import { dayLabel } from "./period";
import { closeMomentLabel } from "./syncService";
import { buildReportHtml } from "./printReport";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

afterEach(() => { vi.useRealTimers(); });

it("a projected date (goal and debt targets, Projections' stages) reads DD/MM/YYYY", () => {
  expect(dateFmt(new Date(2027, 2, 29))).toBe("29/03/2027");
});

it("a single day in a sentence (a reset elsewhere, a close, a trip) reads DD/MM/YYYY", () => {
  expect(dayLabel(new Date(2026, 8, 7))).toBe("07/09/2026");
});

it("a close's moment reads DD/MM/YYYY, then the time", () => {
  expect(closeMomentLabel(new Date(2026, 8, 26, 14, 5).toISOString())).toBe("26/09/2026, 14:05");
});

it("the printed report's date reads DD/MM/YYYY", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 13, 12, 0));
  const data = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
  expect(buildReportHtml("U One", data, computeDashboard(data))).toContain("Generated 13/10/2026");
});

// Every number and date the app formats names its locale, so no browser
// setting changes how a figure reads. (Formatting with no locale follows the
// browser: "١٬٢٣٤٬٥٦٧" in Arabic, "1 234 567" in French.)
it("no formatting call in the app is left to the browser's locale", () => {
  const root = join(__dirname, "..");
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e) && !/\.test\./.test(e)) files.push(p); } };
  for (const d of ["app", "components", "lib"]) walk(join(root, d));
  const BARE = /\.toLocale(String|DateString|TimeString)\(\s*(\)|undefined\b)|Intl\.(NumberFormat|DateTimeFormat)\(\s*(\)|undefined\b)/;
  const found = files.flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => (BARE.test(l) ? `${relative(root, f).replace(/\\/g, "/")}:${i + 1}` : null)).filter(Boolean));
  expect(found).toEqual([]);
});

it("a negative figure in the printed report reads -$1,500, the sign before the dollar", () => {
  const data = { ...DEFAULT_DATA, income: 0, debts: [{ id: "d1", name: "Card", openingBalance: 1500, balance: 1500, apr: 0, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z" }] } as LocalFinancials;
  const html = buildReportHtml("U One", data, computeDashboard(data));
  expect(html).not.toMatch(/\$-\d/);
  expect(html).toMatch(/-\$1,500/);
});
