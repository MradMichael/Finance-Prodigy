// R17 (session 51 review; owner, session 55: build the parts that change no stored data and no wording): the
// Overview's two charts (cash flow, net worth) took about 120 ms of the throttled cold render, and their library
// came with the first page. They now load after the first paint, the way the other screens do (screens.lazy.tsx):
// each chart's box is drawn with its height at once, and the chart draws into it when its code arrives. No words,
// nothing stored. This tests the lazy module itself; the Overview's tests use its plain twin (charts.sync.tsx,
// through vitest.config.ts's alias), so they render the charts at once, as before.
import { it, expect, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { CashFlowChart, NetWorthChart } from "./charts.lazy.tsx";
import { ThemeProvider } from "../contexts/ThemeContext";

afterEach(cleanup);
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), "utf8");

it("the Overview doesn't import the chart library itself: it comes with the charts, after the first paint", () => {
  const src = read("FinancialDashboard.tsx");
  expect(src).not.toMatch(/from "recharts"/);
  expect(src).toMatch(/import \{ CashFlowChart, NetWorthChart \} from "\.\/charts\.lazy";/);
  expect(read("charts.lazy.tsx")).toMatch(/lazyScreen\(\(\) => import\("\.\/overview\/CashFlowChart"\)\)/);
  expect(read("charts.lazy.tsx")).toMatch(/lazyScreen\(\(\) => import\("\.\/overview\/NetWorthChart"\)\)/);
});

it("each chart's box keeps its height in the Overview, so nothing moves when the chart draws in", () => {
  const src = read("FinancialDashboard.tsx");
  expect(src).toMatch(/<div className="h-56">\s*<CashFlowChart /);
  expect(src).toMatch(/<div className="h-40 mb-2">\s*<NetWorthChart /);
});

it("a chart not loaded yet draws nothing (no words), then itself once its code arrives", async () => {
  const trend = [{ ymKey: 202610, income: 3000, spend: 2100 }, { ymKey: 202611, income: 3000, spend: 1900 }];
  const { container } = render(<ThemeProvider><div style={{ width: 400, height: 224 }}><CashFlowChart data={trend} startDay={1} /></div></ThemeProvider>);
  expect(container.textContent).toBe("");
  await waitFor(() => expect(container.querySelector(".recharts-responsive-container")).not.toBeNull());
  cleanup();
  const nw = [{ ym: "2026-10", value: 21000 }, { ym: "2026-11", value: 21500 }];
  const second = render(<ThemeProvider><div style={{ width: 400, height: 160 }}><NetWorthChart data={nw as never} color="#2a9d8f" /></div></ThemeProvider>);
  await waitFor(() => expect(second.container.querySelector(".recharts-responsive-container")).not.toBeNull());
});
