/**
 * R3 (session 33): the test build of screens.lazy.tsx. vitest.config.ts aliases "./screens.lazy" here, so
 * the page tests render a chosen screen at once, as they always have; components/screens-lazy.test.tsx tests the lazy
 * module itself. Same names, same components.
 */
export { default as InputPanel } from "../components/InputPanel";
export { default as TransactionsScreen } from "../components/screens/TransactionsScreen";
export { default as CategoriesScreen } from "../components/screens/CategoriesScreen";
export { default as GoalsScreen } from "../components/screens/GoalsScreen";
export { default as DebtsScreen } from "../components/screens/DebtsScreen";
export { default as BudgetScreen } from "../components/screens/BudgetScreen";
export { default as SetupScreen } from "../components/screens/SetupScreen";
export { default as RecurringScreen } from "../components/screens/RecurringScreen";
export { default as ProjectionsScreen } from "../components/screens/ProjectionsScreen";
export { default as JourneyScreen } from "../components/screens/JourneyScreen";
export { default as CurrencyScreen } from "../components/screens/CurrencyScreen";
export { default as TripsScreen } from "../components/screens/TripsScreen";
export { default as BalanceCheckScreen } from "../components/screens/BalanceCheckScreen";
export { default as WishlistScreen } from "../components/screens/WishlistScreen";
export { default as StatisticsScreen } from "../components/screens/StatisticsScreen";

export function preloadScreens(): Promise<void> {
  return Promise.resolve();
}
