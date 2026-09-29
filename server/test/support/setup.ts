/**
 * Runs before every test file (vitest.config.ts setupFiles). This is where
 * "tests never reach the production database" is enforced -- structurally,
 * not by care (audit 2.4.156). server/.env holds PRODUCTION credentials, and
 * Prisma loads that file BY ITSELF the moment a PrismaClient is constructed.
 * So a test that merely imported src/lib/prisma would connect to production.
 * Three layers, each failing closed:
 *
 *   LAYER 3 (checked first, below): the environment guard. Refuses to run
 *   unless DATABASE_URL and DIRECT_URL are unset or exactly the placeholder
 *   CI uses. An ALLOW-list, not a deny-list: it does not need to know what
 *   production looks like, so it also refuses a new production host, or a
 *   staging one nobody told it about.
 *
 *   LAYER 1: no real PrismaClient can be constructed in this process. Its
 *   constructor throws. The Prisma namespace (error classes, isolation
 *   levels) stays real, because the routes use it.
 *
 *   LAYER 2: src/lib/prisma is replaced by an in-memory fake that records
 *   every write.
 *
 * Removing layer 1 or 2 is still stopped by layer 3 when the environment
 * points anywhere real; removing layer 3 is still stopped by layer 1. Each
 * is tested in test/isolation.test.ts.
 */
import { vi, beforeEach, afterEach } from "vitest";

export const CI_PLACEHOLDER = "postgresql://user:password@localhost:5432/ci_placeholder";

// ── LAYER 3 ──
// Checked, then PINNED. Measured, not assumed: importing @prisma/client loads
// server/.env into process.env at IMPORT time, not only when a client is
// constructed -- the outcome test in isolation.test.ts caught production
// credentials entering this process's environment on the first run, after a
// check that only looked once at startup. Prisma's env loading, like dotenv,
// never overrides a variable that is already set, so pinning both to the
// placeholder BEFORE anything imports Prisma keeps the real values out of
// this process -- and out of any child it spawns.
const CONNECTION_VARS = ["DATABASE_URL", "DIRECT_URL"] as const;
function assertNoRealConnection(when: string): void {
  for (const key of CONNECTION_VARS) {
    const v = process.env[key];
    if (v !== undefined && v !== CI_PLACEHOLDER) {
      // Deliberately does not print the value: it may be a real credential.
      throw new Error(
        `REFUSING TO RUN: ${key} is set to something other than the CI placeholder (${when}). ` +
        `These tests must never reach a real database. Unset it, or set it to the placeholder.`,
      );
    }
  }
}
assertNoRealConnection("at startup");
for (const key of CONNECTION_VARS) process.env[key] = CI_PLACEHOLDER;

// ── LAYER 1 ──
vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  class PrismaClient {
    constructor() {
      throw new Error("REFUSING: a real PrismaClient was constructed in the test process. Tests must use the in-memory fake.");
    }
  }
  return { ...actual, PrismaClient };
});

// ── LAYER 2 ──
vi.mock("../../src/lib/prisma", async () => {
  const { prisma } = await import("./fakePrisma");
  return { prisma };
});

beforeEach(async () => {
  const { store } = await import("./fakePrisma");
  store.reset();
});

// Re-checked after every test: if anything loaded real values after the pin,
// the run stops at the first test that let it happen, not at the end.
afterEach(() => assertNoRealConnection("after a test"));
