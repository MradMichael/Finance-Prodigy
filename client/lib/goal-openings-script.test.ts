// The owner's tool for plan H 5a (scripts/goal-openings.mjs) must list the
// same goals, with the same amounts, that the v7 migration leaves negative.
import { it, expect } from "vitest";
import { DEFAULT_DATA, migrateFinancials, negativeGoalOpenings, type LocalFinancials } from "./localData";
// A plain .mjs tool (allowJs reads its shape).
import { negativeOpenings } from "../scripts/goal-openings.mjs";

it("matches the migration on an export taken before the update", () => {
  const exported = {
    ...DEFAULT_DATA, schemaVersion: 6,
    goals: [
      { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 100, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" },
      { id: "g2", name: "Car", emoji: "🚗", targetAmount: 9000, currentAmount: 900, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" },
      { id: "g3", name: "Trip", emoji: "✈️", targetAmount: 50_000_000, currentAmount: 1_000_000, currency: "LBP", lbpRateAtEntry: 89_500, targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z" },
    ],
    transactions: [
      { id: "c1", amount: 250, currency: "USD", bucket: "SAVINGS", description: "Goal: Laptop", date: "2026-09-10", goalId: "g1" },
      { id: "c2", amount: 300, currency: "USD", bucket: "SAVINGS", description: "Goal: Car", date: "2026-09-10", goalId: "g2" },
      { id: "c2x", amount: 800, currency: "USD", bucket: "SAVINGS", description: "Goal: Car", date: "2026-09-11", goalId: "g2", deletedAt: "2026-09-12T09:00:00.000Z" },
      { id: "c3", amount: 1_500_000, currency: "LBP", lbpRateAtEntry: 89_500, bucket: "SAVINGS", description: "Goal: Trip", date: "2026-09-10", goalId: "g3" },
    ],
  } as unknown as LocalFinancials;
  const fromMigration = negativeGoalOpenings(migrateFinancials(exported));
  expect(fromMigration.map((r) => r.name)).toEqual(["Laptop", "Trip"]); // premise: two negatives, one not
  expect(negativeOpenings(exported)).toEqual(fromMigration);
});
