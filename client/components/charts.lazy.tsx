"use client";

// R17 (session 51 review; owner, session 55): the Overview's charts load after the first paint, the way the other
// screens load on first use (app/screens.lazy.tsx): a chart not loaded yet draws nothing in its box (the box keeps
// its height in the Overview, so nothing moves), and draws itself when its code arrives. Under vitest this module
// is swapped for charts.sync.tsx (vitest.config.ts), so the Overview's tests render the charts at once.
import { lazyScreen } from "../app/screens.lazy";

export const CashFlowChart = lazyScreen(() => import("./overview/CashFlowChart"));
export const NetWorthChart = lazyScreen(() => import("./overview/NetWorthChart"));
