"use client";

/**
 * R3 (owner, session 33, DECISIONS_PENDING 23 (a), "yes if no wording"): the screens other than the
 * Overview, loaded on first use instead of with the first page. Every one of them is fetched once the
 * browser is idle after the first paint (preloadScreens, called from the page), so navigating mid-session
 * still works if the connection drops. Caching in sw.js stays a non-goal (the roadmap; Phase 7). A screen
 * not loaded yet renders nothing for that moment -- no loading text.
 *
 * Under vitest this module is swapped for screens.sync.tsx (vitest.config.ts), which imports the same
 * screens directly, so the page tests keep rendering a screen the moment it's chosen.
 */
import { createElement, useEffect, useState, type ComponentType } from "react";

type Loaded<P> = { default: ComponentType<P> };

export function lazyScreen<P extends object>(load: () => Promise<Loaded<P>>) {
  let component: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  // A load that fails (offline) is forgotten, so the next time the screen opens it tries again (session 33's
  // offline live check: the failed attempt was kept, and the screen stayed blank for the session).
  const preload = (): Promise<void> => (pending ??= load().then(
    (m) => { component = m.default; },
    (err) => { pending = null; throw err; },
  ));
  function LazyScreen(props: P) {
    const [, rerender] = useState(0);
    useEffect(() => {
      if (component) return;
      let live = true;
      preload().then(() => { if (live) rerender((n) => n + 1); }, () => {});
      return () => { live = false; };
    }, []);
    return component ? createElement(component, props) : null;
  }
  LazyScreen.preload = preload;
  return LazyScreen;
}

export const InputPanel = lazyScreen(() => import("../components/InputPanel"));
export const TransactionsScreen = lazyScreen(() => import("../components/screens/TransactionsScreen"));
export const CategoriesScreen = lazyScreen(() => import("../components/screens/CategoriesScreen"));
export const GoalsScreen = lazyScreen(() => import("../components/screens/GoalsScreen"));
export const DebtsScreen = lazyScreen(() => import("../components/screens/DebtsScreen"));
export const BudgetScreen = lazyScreen(() => import("../components/screens/BudgetScreen"));
export const SetupScreen = lazyScreen(() => import("../components/screens/SetupScreen"));
export const RecurringScreen = lazyScreen(() => import("../components/screens/RecurringScreen"));
export const ProjectionsScreen = lazyScreen(() => import("../components/screens/ProjectionsScreen"));
export const JourneyScreen = lazyScreen(() => import("../components/screens/JourneyScreen"));
export const CurrencyScreen = lazyScreen(() => import("../components/screens/CurrencyScreen"));
export const TripsScreen = lazyScreen(() => import("../components/screens/TripsScreen"));
export const BalanceCheckScreen = lazyScreen(() => import("../components/screens/BalanceCheckScreen"));
export const WishlistScreen = lazyScreen(() => import("../components/screens/WishlistScreen"));
export const StatisticsScreen = lazyScreen(() => import("../components/screens/StatisticsScreen"));

const ALL = [InputPanel, TransactionsScreen, CategoriesScreen, GoalsScreen, DebtsScreen, BudgetScreen, SetupScreen, RecurringScreen, ProjectionsScreen, JourneyScreen, CurrencyScreen, TripsScreen, BalanceCheckScreen, WishlistScreen, StatisticsScreen];

/**
 * Fetches every screen's code once; safe to call again (each loads once). Settles even if some can't load
 * (offline): those try again when they're opened.
 */
export function preloadScreens(list: { preload: () => Promise<void> }[] = ALL): Promise<void> {
  return Promise.allSettled(list.map((s) => s.preload())).then(() => undefined);
}
